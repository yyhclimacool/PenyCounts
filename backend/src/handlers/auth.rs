use axum::{
    extract::State,
    Json,
};

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{AuthResponse, LoginRequest, RegisterRequest, UpdateProfileRequest};
use crate::services;

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let resp = services::auth::register(&state.pool, &state.config, req).await?;
    Ok(Json(resp))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let resp = services::auth::login(&state.pool, &state.config, req).await?;
    Ok(Json(resp))
}

pub async fn me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<crate::models::UserResponse>, AppError> {
    let resp = services::auth::get_me(&state.pool, auth.user_id).await?;
    Ok(Json(resp))
}

pub async fn update_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let resp = services::auth::update_profile(&state.pool, &state.config, auth.user_id, req).await?;
    Ok(Json(resp))
}
