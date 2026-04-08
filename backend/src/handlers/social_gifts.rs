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
    let result =
        services::social_gift::list_social_gifts(&state.pool, auth.user_id, filter).await?;
    Ok(Json(result))
}

pub async fn get_social_gift(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<SocialGift>, AppError> {
    let gift = services::social_gift::get_social_gift(&state.pool, auth.user_id, id).await?;
    Ok(Json(gift))
}

pub async fn create_social_gift(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateSocialGiftRequest>,
) -> Result<(StatusCode, Json<SocialGift>), AppError> {
    let gift =
        services::social_gift::create_social_gift(&state.pool, auth.user_id, req).await?;
    Ok((StatusCode::CREATED, Json(gift)))
}

pub async fn update_social_gift(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateSocialGiftRequest>,
) -> Result<Json<SocialGift>, AppError> {
    let gift =
        services::social_gift::update_social_gift(&state.pool, auth.user_id, id, req).await?;
    Ok(Json(gift))
}

pub async fn delete_social_gift(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    services::social_gift::delete_social_gift(&state.pool, auth.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
