use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{Category, CategoryWithSubs, CreateCategoryRequest, CreateSubcategoryRequest, Subcategory};

pub async fn get_all_categories_with_subs(pool: &PgPool, user_id: Uuid) -> Result<Vec<CategoryWithSubs>, AppError> {
    tracing::debug!(user_id = %user_id, "svc::get_all_categories_with_subs: querying categories");
    let categories = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE user_id IS NULL OR user_id = $1 ORDER BY type, sort_order, name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(count = categories.len(), "svc::get_all_categories_with_subs: categories loaded");

    tracing::debug!("svc::get_all_categories_with_subs: querying subcategories");
    let subcategories = sqlx::query_as::<_, Subcategory>(
        "SELECT s.* FROM subcategories s
         INNER JOIN categories c ON s.category_id = c.id
         WHERE (c.user_id IS NULL OR c.user_id = $1)
           AND (s.user_id IS NULL OR s.user_id = $1)
         ORDER BY s.sort_order, s.name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(count = subcategories.len(), "svc::get_all_categories_with_subs: subcategories loaded");

    let mut subs_map: std::collections::HashMap<Uuid, Vec<Subcategory>> = std::collections::HashMap::new();
    for sub in subcategories {
        subs_map.entry(sub.category_id).or_default().push(sub);
    }

    let result = categories
        .into_iter()
        .map(|cat| CategoryWithSubs {
            subcategories: subs_map.remove(&cat.id).unwrap_or_default(),
            id: cat.id,
            user_id: cat.user_id,
            name: cat.name,
            r#type: cat.r#type,
            icon: cat.icon,
            sort_order: cat.sort_order,
        })
        .collect();

    Ok(result)
}

pub async fn get_category(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
) -> Result<Category, AppError> {
    tracing::debug!(user_id = %user_id, category_id = %category_id, "svc::get_category: querying");
    let cat = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE id = $1 AND (user_id IS NULL OR user_id = $2)",
    )
    .bind(category_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        tracing::debug!(category_id = %category_id, "svc::get_category: not found");
        AppError::NotFound("Category not found".to_string())
    })?;
    tracing::debug!(category_id = %cat.id, name = %cat.name, "svc::get_category: found");
    Ok(cat)
}

pub async fn create_category(
    pool: &PgPool,
    user_id: Uuid,
    req: CreateCategoryRequest,
) -> Result<Category, AppError> {
    tracing::debug!(user_id = %user_id, name = %req.name, r#type = %req.r#type, icon = %req.icon, "svc::create_category: validating");
    if req.name.is_empty() {
        return Err(AppError::Validation(
            "Category name cannot be empty".to_string(),
        ));
    }

    let max_sort: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(sort_order) FROM categories WHERE (user_id IS NULL OR user_id = $1) AND type = $2",
    )
    .bind(user_id)
    .bind(&req.r#type)
    .fetch_one(pool)
    .await?;
    tracing::debug!(max_sort = ?max_sort, "svc::create_category: got max sort_order");

    let category = sqlx::query_as::<_, Category>(
        "INSERT INTO categories (id, user_id, name, type, icon, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.r#type)
    .bind(&req.icon)
    .bind(max_sort.unwrap_or(0) + 1)
    .fetch_one(pool)
    .await?;
    tracing::debug!(category_id = %category.id, "svc::create_category: inserted");

    Ok(category)
}

pub async fn update_category(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
    req: CreateCategoryRequest,
) -> Result<Category, AppError> {
    tracing::debug!(user_id = %user_id, category_id = %category_id, name = %req.name, "svc::update_category: checking existing");
    let existing = sqlx::query_as::<_, Category>("SELECT * FROM categories WHERE id = $1")
        .bind(category_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Category not found".to_string()))?;

    if existing.user_id.is_none() {
        tracing::debug!(category_id = %category_id, "svc::update_category: cannot modify system category");
        return Err(AppError::Forbidden(
            "Cannot modify system default categories".to_string(),
        ));
    }

    if existing.user_id != Some(user_id) {
        tracing::debug!(category_id = %category_id, "svc::update_category: not owner");
        return Err(AppError::Forbidden(
            "You can only edit your own categories".to_string(),
        ));
    }

    let category = sqlx::query_as::<_, Category>(
        "UPDATE categories SET name = $1, type = $2, icon = $3 WHERE id = $4 RETURNING *",
    )
    .bind(&req.name)
    .bind(&req.r#type)
    .bind(&req.icon)
    .bind(category_id)
    .fetch_one(pool)
    .await?;
    tracing::debug!(category_id = %category.id, name = %category.name, "svc::update_category: updated");

    Ok(category)
}

pub async fn delete_category(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
) -> Result<(), AppError> {
    tracing::debug!(user_id = %user_id, category_id = %category_id, "svc::delete_category: checking existing");
    let existing = sqlx::query_as::<_, Category>("SELECT * FROM categories WHERE id = $1")
        .bind(category_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Category not found".to_string()))?;

    if existing.user_id.is_none() {
        return Err(AppError::Forbidden(
            "Cannot delete system default categories".to_string(),
        ));
    }

    if existing.user_id != Some(user_id) {
        return Err(AppError::Forbidden(
            "You can only delete your own categories".to_string(),
        ));
    }

    sqlx::query("DELETE FROM categories WHERE id = $1")
        .bind(category_id)
        .execute(pool)
        .await?;
    tracing::debug!(category_id = %category_id, "svc::delete_category: deleted");

    Ok(())
}

// ── Subcategories ────────────────────────────────────────────────────

pub async fn get_subcategories(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
) -> Result<Vec<Subcategory>, AppError> {
    tracing::debug!(user_id = %user_id, category_id = %category_id, "svc::get_subcategories: querying");
    let subs = sqlx::query_as::<_, Subcategory>(
        "SELECT * FROM subcategories
         WHERE category_id = $1 AND (user_id IS NULL OR user_id = $2)
         ORDER BY sort_order, name",
    )
    .bind(category_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(count = subs.len(), "svc::get_subcategories: done");

    Ok(subs)
}

pub async fn create_subcategory(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
    req: CreateSubcategoryRequest,
) -> Result<Subcategory, AppError> {
    tracing::debug!(user_id = %user_id, category_id = %category_id, name = %req.name, "svc::create_subcategory: validating");
    if req.name.is_empty() {
        return Err(AppError::Validation(
            "Subcategory name cannot be empty".to_string(),
        ));
    }

    let max_sort: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(sort_order) FROM subcategories WHERE category_id = $1 AND (user_id IS NULL OR user_id = $2)",
    )
    .bind(category_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    tracing::debug!(max_sort = ?max_sort, "svc::create_subcategory: got max sort_order");

    let sub = sqlx::query_as::<_, Subcategory>(
        "INSERT INTO subcategories (id, category_id, user_id, name, icon, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(category_id)
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.icon)
    .bind(max_sort.unwrap_or(0) + 1)
    .fetch_one(pool)
    .await?;
    tracing::debug!(sub_id = %sub.id, "svc::create_subcategory: inserted");

    Ok(sub)
}

pub async fn update_subcategory(
    pool: &PgPool,
    user_id: Uuid,
    subcategory_id: Uuid,
    req: CreateSubcategoryRequest,
) -> Result<Subcategory, AppError> {
    tracing::debug!(user_id = %user_id, sub_id = %subcategory_id, name = %req.name, "svc::update_subcategory: checking existing");
    let existing =
        sqlx::query_as::<_, Subcategory>("SELECT * FROM subcategories WHERE id = $1")
            .bind(subcategory_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("Subcategory not found".to_string()))?;

    if existing.user_id.is_none() {
        return Err(AppError::Forbidden(
            "Cannot modify system default subcategories".to_string(),
        ));
    }

    if existing.user_id != Some(user_id) {
        return Err(AppError::Forbidden(
            "You can only edit your own subcategories".to_string(),
        ));
    }

    let sub = sqlx::query_as::<_, Subcategory>(
        "UPDATE subcategories SET name = $1, icon = $2 WHERE id = $3 RETURNING *",
    )
    .bind(&req.name)
    .bind(&req.icon)
    .bind(subcategory_id)
    .fetch_one(pool)
    .await?;
    tracing::debug!(sub_id = %sub.id, name = %sub.name, "svc::update_subcategory: updated");

    Ok(sub)
}

pub async fn delete_subcategory(
    pool: &PgPool,
    user_id: Uuid,
    subcategory_id: Uuid,
) -> Result<(), AppError> {
    tracing::debug!(user_id = %user_id, sub_id = %subcategory_id, "svc::delete_subcategory: checking existing");
    let existing =
        sqlx::query_as::<_, Subcategory>("SELECT * FROM subcategories WHERE id = $1")
            .bind(subcategory_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("Subcategory not found".to_string()))?;

    if existing.user_id.is_none() {
        return Err(AppError::Forbidden(
            "Cannot delete system default subcategories".to_string(),
        ));
    }

    if existing.user_id != Some(user_id) {
        return Err(AppError::Forbidden(
            "You can only delete your own subcategories".to_string(),
        ));
    }

    sqlx::query("DELETE FROM subcategories WHERE id = $1")
        .bind(subcategory_id)
        .execute(pool)
        .await?;
    tracing::debug!(sub_id = %subcategory_id, "svc::delete_subcategory: deleted");

    Ok(())
}
