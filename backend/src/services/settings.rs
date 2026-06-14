//! User-configuration import/export (JSON).
//!
//! Aggregates a user's configurable data (profile, current family, LLM config,
//! transaction-split members, custom categories) into a single versioned JSON
//! envelope and applies it back. Every section is optional, so partial files
//! import cleanly and the format degrades gracefully across versions.
//!
//! When adding a new configurable feature, add an optional field to
//! [`SettingsExport`](crate::models::SettingsExport) and handle it in both
//! [`export_settings`] and [`import_settings`].

use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    Category, CategorySettings, FamilySettings, LlmConfig, LlmConfigSettings, SettingsExport,
    SettingsImportResult, Subcategory, SubcategorySettings, User, UserResponse, UserSettings,
    SETTINGS_EXPORT_VERSION,
};

pub async fn export_settings(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
) -> Result<SettingsExport, AppError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await?;

    let family_name: Option<(String,)> =
        sqlx::query_as("SELECT name FROM families WHERE id = $1")
            .bind(family_id)
            .fetch_optional(pool)
            .await?;

    let llm = sqlx::query_as::<_, LlmConfig>(
        "SELECT * FROM llm_configs WHERE family_id = $1 ORDER BY is_active DESC LIMIT 1",
    )
    .bind(family_id)
    .fetch_optional(pool)
    .await?;

    let member_names: Vec<String> =
        sqlx::query_scalar("SELECT name FROM members WHERE family_id = $1 ORDER BY name")
            .bind(family_id)
            .fetch_all(pool)
            .await?;

    let categories = export_custom_categories(pool, family_id).await?;

    Ok(SettingsExport {
        version: SETTINGS_EXPORT_VERSION,
        app: "PenyCounts".to_string(),
        exported_at: Some(Utc::now()),
        user: Some(UserSettings {
            nickname: Some(user.nickname),
            avatar_url: user.avatar_url,
        }),
        family: Some(FamilySettings {
            name: family_name.map(|f| f.0),
        }),
        llm_config: llm.map(|c| LlmConfigSettings {
            provider: c.provider,
            api_url: c.api_url,
            api_key: c.api_key,
            model_name: c.model_name,
        }),
        members: Some(member_names),
        categories: Some(categories),
    })
}

/// Family-created (non system-default) categories + their custom subcategories.
async fn export_custom_categories(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<Vec<CategorySettings>, AppError> {
    let categories = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE user_id IS NOT NULL AND family_id = $1 ORDER BY type, sort_order, name",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::with_capacity(categories.len());
    for cat in categories {
        let subs = sqlx::query_as::<_, Subcategory>(
            "SELECT * FROM subcategories WHERE category_id = $1 AND user_id IS NOT NULL AND family_id = $2 ORDER BY sort_order, name",
        )
        .bind(cat.id)
        .bind(family_id)
        .fetch_all(pool)
        .await?;

        result.push(CategorySettings {
            name: cat.name,
            r#type: cat.r#type,
            icon: cat.icon,
            subcategories: subs
                .into_iter()
                .map(|s| SubcategorySettings {
                    name: s.name,
                    icon: s.icon,
                })
                .collect(),
        });
    }
    Ok(result)
}

pub async fn import_settings(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    data: SettingsExport,
) -> Result<SettingsImportResult, AppError> {
    let mut applied: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    // ── User profile (nickname + avatar). Username/password are intentionally
    //    not imported to avoid identity conflicts.
    if let Some(u) = data.user {
        let mut sets: Vec<String> = Vec::new();
        let mut idx = 1u32;
        let nickname = u.nickname.and_then(|n| {
            let t = n.trim().to_string();
            if t.is_empty() || t.len() > 100 { None } else { Some(t) }
        });
        if nickname.is_some() {
            sets.push(format!("nickname = ${idx}"));
            idx += 1;
        }
        if u.avatar_url.is_some() {
            sets.push(format!("avatar_url = ${idx}"));
            idx += 1;
        }
        if sets.is_empty() {
            skipped.push("个人资料（无可应用字段）".to_string());
        } else {
            sets.push(format!("updated_at = ${idx}"));
            idx += 1;
            let sql = format!("UPDATE users SET {} WHERE id = ${}", sets.join(", "), idx);
            let mut q = sqlx::query(&sql);
            if let Some(n) = &nickname {
                q = q.bind(n);
            }
            if let Some(a) = &u.avatar_url {
                q = q.bind(a);
            }
            q = q.bind(Utc::now()).bind(user_id);
            q.execute(pool).await?;
            applied.push("个人资料".to_string());
        }
    }

    // ── Family name (current/default family).
    if let Some(f) = data.family {
        if let Some(name) = f.name {
            let name = name.trim().to_string();
            if name.is_empty() || name.len() > 100 {
                skipped.push("家庭信息（名称无效）".to_string());
            } else {
                sqlx::query("UPDATE families SET name = $1 WHERE id = $2")
                    .bind(&name)
                    .bind(family_id)
                    .execute(pool)
                    .await?;
                applied.push("家庭信息".to_string());
            }
        }
    }

    // ── LLM config: deactivate existing then insert as the active config.
    if let Some(c) = data.llm_config {
        if c.api_url.trim().is_empty() || c.model_name.trim().is_empty() {
            skipped.push("LLM 配置（缺少必填项）".to_string());
        } else {
            sqlx::query("UPDATE llm_configs SET is_active = false WHERE family_id = $1")
                .bind(family_id)
                .execute(pool)
                .await?;
            sqlx::query(
                "INSERT INTO llm_configs (id, user_id, family_id, provider, api_url, api_key, model_name, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, true)",
            )
            .bind(Uuid::new_v4())
            .bind(user_id)
            .bind(family_id)
            .bind(c.provider.trim())
            .bind(c.api_url.trim())
            .bind(&c.api_key)
            .bind(c.model_name.trim())
            .execute(pool)
            .await?;
            applied.push("LLM 配置".to_string());
        }
    }

    // ── Members: insert names that don't already exist (family-scoped unique).
    if let Some(names) = data.members {
        let mut added = 0usize;
        for raw in names {
            let name = raw.trim().to_string();
            if name.is_empty() || name.len() > 100 {
                continue;
            }
            let exists: Option<(Uuid,)> =
                sqlx::query_as("SELECT id FROM members WHERE family_id = $1 AND name = $2")
                    .bind(family_id)
                    .bind(&name)
                    .fetch_optional(pool)
                    .await?;
            if exists.is_some() {
                continue;
            }
            sqlx::query("INSERT INTO members (id, user_id, family_id, name) VALUES ($1, $2, $3, $4)")
                .bind(Uuid::new_v4())
                .bind(user_id)
                .bind(family_id)
                .bind(&name)
                .execute(pool)
                .await?;
            added += 1;
        }
        if added > 0 {
            applied.push(format!("家庭成员（新增 {added} 个）"));
        } else {
            skipped.push("家庭成员（无新增）".to_string());
        }
    }

    // ── Custom categories + subcategories: create missing ones (by name+type).
    if let Some(cats) = data.categories {
        let added = import_categories(pool, user_id, family_id, cats).await?;
        if added > 0 {
            applied.push(format!("自定义分类（新增 {added} 个）"));
        } else {
            skipped.push("自定义分类（无新增）".to_string());
        }
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await?;

    Ok(SettingsImportResult {
        applied,
        skipped,
        user: UserResponse::from_user(&user),
    })
}

/// Returns the number of categories newly created (subcategories not counted).
async fn import_categories(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    cats: Vec<CategorySettings>,
) -> Result<usize, AppError> {
    let mut added = 0usize;
    for cat in cats {
        let name = cat.name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        // Match an existing accessible category (system default or this family's).
        let existing: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM categories WHERE name = $1 AND type = $2 AND (user_id IS NULL OR family_id = $3) LIMIT 1",
        )
        .bind(&name)
        .bind(&cat.r#type)
        .bind(family_id)
        .fetch_optional(pool)
        .await?;

        let category_id = match existing {
            Some((id,)) => id,
            None => {
                let max_sort: Option<i32> = sqlx::query_scalar(
                    "SELECT MAX(sort_order) FROM categories WHERE (user_id IS NULL OR family_id = $1) AND type = $2",
                )
                .bind(family_id)
                .bind(&cat.r#type)
                .fetch_one(pool)
                .await?;
                let id = Uuid::new_v4();
                sqlx::query(
                    "INSERT INTO categories (id, user_id, family_id, name, type, icon, sort_order)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)",
                )
                .bind(id)
                .bind(user_id)
                .bind(family_id)
                .bind(&name)
                .bind(&cat.r#type)
                .bind(&cat.icon)
                .bind(max_sort.unwrap_or(0) + 1)
                .execute(pool)
                .await?;
                added += 1;
                id
            }
        };

        for sub in cat.subcategories {
            let sub_name = sub.name.trim().to_string();
            if sub_name.is_empty() {
                continue;
            }
            let sub_exists: Option<(Uuid,)> = sqlx::query_as(
                "SELECT id FROM subcategories WHERE category_id = $1 AND name = $2 AND (user_id IS NULL OR family_id = $3) LIMIT 1",
            )
            .bind(category_id)
            .bind(&sub_name)
            .bind(family_id)
            .fetch_optional(pool)
            .await?;
            if sub_exists.is_some() {
                continue;
            }
            let max_sort: Option<i32> = sqlx::query_scalar(
                "SELECT MAX(sort_order) FROM subcategories WHERE category_id = $1 AND (user_id IS NULL OR family_id = $2)",
            )
            .bind(category_id)
            .bind(family_id)
            .fetch_one(pool)
            .await?;
            sqlx::query(
                "INSERT INTO subcategories (id, category_id, user_id, family_id, name, icon, sort_order)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(Uuid::new_v4())
            .bind(category_id)
            .bind(user_id)
            .bind(family_id)
            .bind(&sub_name)
            .bind(&sub.icon)
            .bind(max_sort.unwrap_or(0) + 1)
            .execute(pool)
            .await?;
        }
    }
    Ok(added)
}
