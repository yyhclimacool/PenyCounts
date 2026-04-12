use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{
    CreateSocialGiftRequest, PaginatedResponse, SocialGift, SocialGiftFilter,
};
use crate::services;

pub async fn list_social_gifts(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(filter): Query<SocialGiftFilter>,
) -> Result<Json<PaginatedResponse<SocialGift>>, AppError> {
    tracing::debug!(user_id = %auth.user_id, ?filter, "list_social_gifts: received request");
    let result =
        services::social_gift::list_social_gifts(&state.pool, auth.user_id, filter).await?;
    tracing::debug!(user_id = %auth.user_id, total = result.total, returned = result.data.len(), "list_social_gifts: returning data");
    Ok(Json(result))
}

pub async fn get_social_gift(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<SocialGift>, AppError> {
    tracing::debug!(user_id = %auth.user_id, gift_id = %id, "get_social_gift: received request");
    let gift = services::social_gift::get_social_gift(&state.pool, auth.user_id, id).await?;
    tracing::debug!(gift_id = %id, person = %gift.person_name, "get_social_gift: returning gift");
    Ok(Json(gift))
}

pub async fn create_social_gift(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateSocialGiftRequest>,
) -> Result<(StatusCode, Json<SocialGift>), AppError> {
    tracing::debug!(user_id = %auth.user_id, ?req, "create_social_gift: received request");
    let gift =
        services::social_gift::create_social_gift(&state.pool, auth.user_id, req).await?;
    tracing::info!(gift_id = %gift.id, person = %gift.person_name, amount = %gift.amount, "create_social_gift: created successfully");
    Ok((StatusCode::CREATED, Json(gift)))
}

pub async fn update_social_gift(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateSocialGiftRequest>,
) -> Result<Json<SocialGift>, AppError> {
    tracing::debug!(user_id = %auth.user_id, gift_id = %id, ?req, "update_social_gift: received request");
    let gift =
        services::social_gift::update_social_gift(&state.pool, auth.user_id, id, req).await?;
    tracing::info!(gift_id = %gift.id, person = %gift.person_name, "update_social_gift: updated successfully");
    Ok(Json(gift))
}

pub async fn delete_social_gift(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    tracing::debug!(user_id = %auth.user_id, gift_id = %id, "delete_social_gift: received request");
    services::social_gift::delete_social_gift(&state.pool, auth.user_id, id).await?;
    tracing::info!(gift_id = %id, "delete_social_gift: deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}
