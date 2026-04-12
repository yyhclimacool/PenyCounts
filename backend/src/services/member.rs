use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{CreateMemberRequest, Member};

pub async fn list_members(pool: &PgPool, user_id: Uuid) -> Result<Vec<Member>, AppError> {
    tracing::debug!(user_id = %user_id, "svc::list_members: querying");
    let members = sqlx::query_as::<_, Member>(
        "SELECT * FROM members WHERE user_id = $1 ORDER BY name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(count = members.len(), "svc::list_members: done");

    Ok(members)
}

pub async fn get_member(
    pool: &PgPool,
    user_id: Uuid,
    member_id: Uuid,
) -> Result<Member, AppError> {
    tracing::debug!(user_id = %user_id, member_id = %member_id, "svc::get_member: querying");
    let member = sqlx::query_as::<_, Member>(
        "SELECT * FROM members WHERE id = $1 AND user_id = $2",
    )
    .bind(member_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        tracing::debug!(member_id = %member_id, "svc::get_member: not found");
        AppError::NotFound("Member not found".to_string())
    })?;
    tracing::debug!(member_id = %member.id, name = %member.name, "svc::get_member: found");
    Ok(member)
}

pub async fn create_member(
    pool: &PgPool,
    user_id: Uuid,
    req: CreateMemberRequest,
) -> Result<Member, AppError> {
    tracing::debug!(user_id = %user_id, name = %req.name, "svc::create_member: validating");
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
    tracing::debug!(member_id = %member.id, name = %member.name, "svc::create_member: inserted");

    Ok(member)
}

pub async fn update_member(
    pool: &PgPool,
    user_id: Uuid,
    member_id: Uuid,
    req: CreateMemberRequest,
) -> Result<Member, AppError> {
    tracing::debug!(user_id = %user_id, member_id = %member_id, new_name = %req.name, "svc::update_member: validating");
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
    .ok_or_else(|| {
        tracing::debug!(member_id = %member_id, "svc::update_member: not found");
        AppError::NotFound("Member not found".to_string())
    })?;
    tracing::debug!(member_id = %member.id, name = %member.name, "svc::update_member: updated");

    Ok(member)
}

pub async fn delete_member(
    pool: &PgPool,
    user_id: Uuid,
    member_id: Uuid,
) -> Result<(), AppError> {
    tracing::debug!(user_id = %user_id, member_id = %member_id, "svc::delete_member: executing DELETE");
    let result = sqlx::query("DELETE FROM members WHERE id = $1 AND user_id = $2")
        .bind(member_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    tracing::debug!(rows_affected = result.rows_affected(), "svc::delete_member: done");
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Member not found".to_string()));
    }

    Ok(())
}
