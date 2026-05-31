use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    CreateFamilyRequest, Family, FamilyDetailResponse, FamilyMemberInfo, FamilyResponse,
    JoinFamilyRequest, SwitchFamilyRequest,
};

fn generate_invite_code() -> String {
    let id = Uuid::new_v4().to_string().replace('-', "");
    id[..8].to_uppercase()
}

pub async fn create_family(
    pool: &PgPool,
    user_id: Uuid,
    req: CreateFamilyRequest,
) -> Result<FamilyResponse, AppError> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::Validation("家庭名称不能为空且不超过100字符".into()));
    }

    let family_id = Uuid::new_v4();
    let code = generate_invite_code();

    sqlx::query(
        "INSERT INTO families (id, name, invite_code, created_by) VALUES ($1, $2, $3, $4)",
    )
    .bind(family_id)
    .bind(&name)
    .bind(&code)
    .bind(user_id)
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(family_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(FamilyResponse {
        id: family_id,
        name,
        invite_code: code,
        role: "owner".into(),
        member_count: 1,
        created_at: chrono::Utc::now(),
    })
}

pub async fn list_families(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<FamilyResponse>, AppError> {
    let rows = sqlx::query_as::<_, FamilyResponse>(
        "SELECT f.id, f.name, f.invite_code, fm.role, f.created_at, \
         (SELECT COUNT(*) FROM family_members WHERE family_id = f.id) AS member_count \
         FROM families f \
         JOIN family_members fm ON fm.family_id = f.id AND fm.user_id = $1 \
         ORDER BY f.created_at",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_family_detail(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
) -> Result<FamilyDetailResponse, AppError> {
    let family = sqlx::query_as::<_, Family>(
        "SELECT f.* FROM families f \
         JOIN family_members fm ON fm.family_id = f.id AND fm.user_id = $1 \
         WHERE f.id = $2",
    )
    .bind(user_id)
    .bind(family_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("家庭不存在或无权访问".into()))?;

    let members = sqlx::query_as::<_, FamilyMemberInfo>(
        "SELECT fm.user_id, u.nickname, u.avatar_url, fm.role, fm.joined_at \
         FROM family_members fm \
         JOIN users u ON u.id = fm.user_id \
         WHERE fm.family_id = $1 \
         ORDER BY fm.role DESC, fm.joined_at",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;

    Ok(FamilyDetailResponse {
        id: family.id,
        name: family.name,
        invite_code: family.invite_code,
        members,
    })
}

pub async fn join_family(
    pool: &PgPool,
    user_id: Uuid,
    req: JoinFamilyRequest,
) -> Result<FamilyResponse, AppError> {
    let code = req.invite_code.trim().to_uppercase();
    let family = sqlx::query_as::<_, Family>(
        "SELECT * FROM families WHERE invite_code = $1",
    )
    .bind(&code)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("邀请码无效".into()))?;

    let existing = sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM family_members WHERE family_id = $1 AND user_id = $2",
    )
    .bind(family.id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if existing.is_some() {
        return Err(AppError::BadRequest("您已是该家庭成员".into()));
    }

    sqlx::query(
        "INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(family.id)
    .bind(user_id)
    .execute(pool)
    .await?;

    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM family_members WHERE family_id = $1",
    )
    .bind(family.id)
    .fetch_one(pool)
    .await?;

    Ok(FamilyResponse {
        id: family.id,
        name: family.name,
        invite_code: family.invite_code,
        role: "member".into(),
        member_count: count.0,
        created_at: family.created_at,
    })
}

pub async fn leave_family(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
) -> Result<(), AppError> {
    let membership = sqlx::query_as::<_, (String,)>(
        "SELECT role FROM family_members WHERE family_id = $1 AND user_id = $2",
    )
    .bind(family_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("您不是该家庭成员".into()))?;

    if membership.0 == "owner" {
        return Err(AppError::BadRequest("家庭创建者不能退出家庭".into()));
    }

    sqlx::query("DELETE FROM family_members WHERE family_id = $1 AND user_id = $2")
        .bind(family_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    let default: (Uuid,) = sqlx::query_as("SELECT default_family_id FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await?;

    if default.0 == family_id {
        let other: Option<(Uuid,)> = sqlx::query_as(
            "SELECT family_id FROM family_members WHERE user_id = $1 LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        if let Some(other_fam) = other {
            sqlx::query("UPDATE users SET default_family_id = $1 WHERE id = $2")
                .bind(other_fam.0)
                .bind(user_id)
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}

pub async fn switch_default_family(
    pool: &PgPool,
    user_id: Uuid,
    req: SwitchFamilyRequest,
) -> Result<(), AppError> {
    let membership = sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM family_members WHERE family_id = $1 AND user_id = $2",
    )
    .bind(req.family_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if membership.is_none() {
        return Err(AppError::BadRequest("您不是该家庭成员".into()));
    }

    sqlx::query("UPDATE users SET default_family_id = $1 WHERE id = $2")
        .bind(req.family_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn regenerate_invite_code(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
) -> Result<String, AppError> {
    let role = sqlx::query_as::<_, (String,)>(
        "SELECT role FROM family_members WHERE family_id = $1 AND user_id = $2",
    )
    .bind(family_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("您不是该家庭成员".into()))?;

    if role.0 != "owner" {
        return Err(AppError::BadRequest("只有家庭创建者可以重新生成邀请码".into()));
    }

    let new_code = generate_invite_code();
    sqlx::query("UPDATE families SET invite_code = $1 WHERE id = $2")
        .bind(&new_code)
        .bind(family_id)
        .execute(pool)
        .await?;

    Ok(new_code)
}

pub async fn delete_family(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
) -> Result<(), AppError> {
    let role = sqlx::query_as::<_, (String,)>(
        "SELECT role FROM family_members WHERE family_id = $1 AND user_id = $2",
    )
    .bind(family_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("您不是该家庭成员".into()))?;

    if role.0 != "owner" {
        return Err(AppError::BadRequest("只有家庭创建者可以删除家庭".into()));
    }

    let default: (Uuid,) = sqlx::query_as("SELECT default_family_id FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await?;

    if default.0 == family_id {
        return Err(AppError::BadRequest("不能删除默认家庭，请先切换默认家庭".into()));
    }

    sqlx::query("DELETE FROM families WHERE id = $1")
        .bind(family_id)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn create_default_family(pool: &PgPool, user_id: Uuid) -> Result<Uuid, AppError> {
    let family_id = Uuid::new_v4();
    let code = generate_invite_code();

    sqlx::query(
        "INSERT INTO families (id, name, invite_code, created_by) VALUES ($1, '我的家庭', $2, $3)",
    )
    .bind(family_id)
    .bind(&code)
    .bind(user_id)
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(family_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    sqlx::query("UPDATE users SET default_family_id = $1 WHERE id = $2")
        .bind(family_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(family_id)
}
