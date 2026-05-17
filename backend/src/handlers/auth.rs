use axum::{
    extract::State,
    Json,
};

use crate::config::AppState;
use crate::errors::AppError;
use crate::models::{AuthResponse, LoginRequest, RegisterRequest};
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
