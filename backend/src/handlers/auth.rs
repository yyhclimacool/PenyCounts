use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::config::AppState;
use crate::errors::AppError;
use crate::models::{
    AuthResponse, ForgotPasswordRequest, LoginRequest, RegisterRequest, ResetPasswordRequest,
    UserResponse,
};
use crate::services;

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<UserResponse>), AppError> {
    let user = services::auth::register(&state.pool, &state.config, req).await?;
    Ok((StatusCode::CREATED, Json(user)))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let resp = services::auth::login(&state.pool, &state.config, req).await?;
    Ok(Json(resp))
}

#[derive(Deserialize)]
pub struct VerifyEmailQuery {
    pub token: String,
}

pub async fn verify_email(
    State(state): State<AppState>,
    Query(query): Query<VerifyEmailQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    services::auth::verify_email(&state.pool, &query.token).await?;
    Ok(Json(serde_json::json!({ "message": "Email verified successfully" })))
}

pub async fn forgot_password(
    State(state): State<AppState>,
    Json(req): Json<ForgotPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    services::auth::forgot_password(&state.pool, &state.config, &req.email).await?;
    Ok(Json(serde_json::json!({
        "message": "If the email exists, a reset link has been sent"
    })))
}

pub async fn reset_password(
    State(state): State<AppState>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    services::auth::reset_password(&state.pool, &req.token, &req.new_password).await?;
    Ok(Json(serde_json::json!({ "message": "Password reset successfully" })))
}
