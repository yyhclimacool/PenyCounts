use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{CreateMemberRequest, Member};

pub async fn list_members(pool: &PgPool, user_id: Uuid) -> Result<Vec<Member>, AppError> {
    let members = sqlx::query_as::<_, Member>(
        "SELECT * FROM members WHERE user_id = $1 ORDER BY name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(members)
}

pub async fn get_member(
    pool: &PgPool,
    user_id: Uuid,
    member_id: Uuid,
) -> Result<Member, AppError> {
    sqlx::query_as::<_, Member>(
        "SELECT * FROM members WHERE id = $1 AND user_id = $2",
    )
    .bind(member_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Member not found".to_string()))
}

pub async fn create_member(
    pool: &PgPool,
    user_id: Uuid,
    req: CreateMemberRequest,
) -> Result<Member, AppError> {
    if req.name.is_empty() {
        return Err(AppError::Validation(
            "Member name cannot be empty".to_string(),
        ));
    }

    let member = sqlx::query_as::<_, Member>(
        "INSERT INTO members (id, user_id, name) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&req.name)
    .fetch_one(pool)
    .await?;

    Ok(member)
}

pub async fn update_member(
    pool: &PgPool,
    user_id: Uuid,
    member_id: Uuid,
    req: CreateMemberRequest,
) -> Result<Member, AppError> {
    if req.name.is_empty() {
        return Err(AppError::Validation(
            "Member name cannot be empty".to_string(),
        ));
    }

    let member = sqlx::query_as::<_, Member>(
        "UPDATE members SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
    )
    .bind(&req.name)
    .bind(member_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Member not found".to_string()))?;

    Ok(member)
}

pub async fn delete_member(
    pool: &PgPool,
    user_id: Uuid,
    member_id: Uuid,
) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM members WHERE id = $1 AND user_id = $2")
        .bind(member_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Member not found".to_string()));
    }

    Ok(())
}
