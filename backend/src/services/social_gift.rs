use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{CreateSocialGiftRequest, PaginatedResponse, SocialGift, SocialGiftFilter};

pub async fn create_social_gift(
    pool: &PgPool,
    user_id: Uuid,
    req: CreateSocialGiftRequest,
) -> Result<SocialGift, AppError> {
    tracing::debug!(
        user_id = %user_id,
        person = %req.person_name,
        r#type = %req.r#type,
        amount = %req.amount,
        occasion = ?req.occasion,
        "svc::create_social_gift: validating"
    );
    if req.person_name.is_empty() {
        return Err(AppError::Validation(
            "Person name cannot be empty".to_string(),
        ));
    }

    let gift = sqlx::query_as::<_, SocialGift>(
        "INSERT INTO social_gifts (id, user_id, type, person_name, relation, occasion, amount, currency, date, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&req.r#type)
    .bind(&req.person_name)
    .bind(&req.relation)
    .bind(&req.occasion)
    .bind(req.amount)
    .bind(&req.currency)
    .bind(req.date)
    .bind(&req.note)
    .bind(Utc::now())
    .fetch_one(pool)
    .await?;
    tracing::debug!(gift_id = %gift.id, "svc::create_social_gift: inserted");

    Ok(gift)
}

pub async fn get_social_gift(
    pool: &PgPool,
    user_id: Uuid,
    gift_id: Uuid,
) -> Result<SocialGift, AppError> {
    tracing::debug!(user_id = %user_id, gift_id = %gift_id, "svc::get_social_gift: querying");
    let gift = sqlx::query_as::<_, SocialGift>(
        "SELECT * FROM social_gifts WHERE id = $1 AND user_id = $2",
    )
    .bind(gift_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        tracing::debug!(gift_id = %gift_id, "svc::get_social_gift: not found");
        AppError::NotFound("Social gift not found".to_string())
    })?;
    tracing::debug!(gift_id = %gift.id, person = %gift.person_name, "svc::get_social_gift: found");
    Ok(gift)
}

pub async fn list_social_gifts(
    pool: &PgPool,
    user_id: Uuid,
    filter: SocialGiftFilter,
) -> Result<PaginatedResponse<SocialGift>, AppError> {
    let page = filter.page.unwrap_or(1).max(1);
    let per_page = filter.per_page.unwrap_or(20).min(100);
    let offset = ((page - 1) * per_page) as i64;
    tracing::debug!(
        user_id = %user_id,
        page = page,
        per_page = per_page,
        r#type = ?filter.r#type,
        person_name = ?filter.person_name,
        year = ?filter.year,
        "svc::list_social_gifts: executing count query"
    );

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM social_gifts
         WHERE user_id = $1
           AND ($2::text IS NULL OR type = $2)
           AND ($3::text IS NULL OR person_name ILIKE '%' || $3 || '%')
           AND ($4::int IS NULL OR EXTRACT(YEAR FROM date) = $4)",
    )
    .bind(user_id)
    .bind(&filter.r#type)
    .bind(&filter.person_name)
    .bind(filter.year)
    .fetch_one(pool)
    .await?;
    tracing::debug!(total = total.0, "svc::list_social_gifts: count result");

    let gifts = sqlx::query_as::<_, SocialGift>(
        "SELECT * FROM social_gifts
         WHERE user_id = $1
           AND ($2::text IS NULL OR type = $2)
           AND ($3::text IS NULL OR person_name ILIKE '%' || $3 || '%')
           AND ($4::int IS NULL OR EXTRACT(YEAR FROM date) = $4)
         ORDER BY date DESC
         LIMIT $5 OFFSET $6",
    )
    .bind(user_id)
    .bind(&filter.r#type)
    .bind(&filter.person_name)
    .bind(filter.year)
    .bind(per_page as i64)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    tracing::debug!(rows = gifts.len(), "svc::list_social_gifts: data query done");

    Ok(PaginatedResponse {
        data: gifts,
        total: total.0,
        page,
        per_page,
    })
}

pub async fn update_social_gift(
    pool: &PgPool,
    user_id: Uuid,
    gift_id: Uuid,
    req: CreateSocialGiftRequest,
) -> Result<SocialGift, AppError> {
    tracing::debug!(
        user_id = %user_id,
        gift_id = %gift_id,
        person = %req.person_name,
        r#type = %req.r#type,
        amount = %req.amount,
        "svc::update_social_gift: executing UPDATE"
    );
    let gift = sqlx::query_as::<_, SocialGift>(
        "UPDATE social_gifts
         SET type = $1, person_name = $2, relation = $3, occasion = $4,
             amount = $5, currency = $6, date = $7, note = $8
         WHERE id = $9 AND user_id = $10
         RETURNING *",
    )
    .bind(&req.r#type)
    .bind(&req.person_name)
    .bind(&req.relation)
    .bind(&req.occasion)
    .bind(req.amount)
    .bind(&req.currency)
    .bind(req.date)
    .bind(&req.note)
    .bind(gift_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        tracing::debug!(gift_id = %gift_id, "svc::update_social_gift: not found");
        AppError::NotFound("Social gift not found".to_string())
    })?;
    tracing::debug!(gift_id = %gift.id, "svc::update_social_gift: updated");

    Ok(gift)
}

pub async fn delete_social_gift(
    pool: &PgPool,
    user_id: Uuid,
    gift_id: Uuid,
) -> Result<(), AppError> {
    tracing::debug!(user_id = %user_id, gift_id = %gift_id, "svc::delete_social_gift: executing DELETE");
    let result = sqlx::query("DELETE FROM social_gifts WHERE id = $1 AND user_id = $2")
        .bind(gift_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    tracing::debug!(rows_affected = result.rows_affected(), "svc::delete_social_gift: done");
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Social gift not found".to_string()));
    }

    Ok(())
}
