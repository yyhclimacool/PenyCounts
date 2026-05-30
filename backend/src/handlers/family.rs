use axum::extract::{Path, State};
use axum::Json;
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{
    CreateFamilyRequest, FamilyDetailResponse, FamilyResponse, JoinFamilyRequest,
    SwitchFamilyRequest,
};
use crate::services;

pub async fn create_family(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateFamilyRequest>,
) -> Result<Json<FamilyResponse>, AppError> {
    let resp = services::family::create_family(&state.pool, auth.user_id, req).await?;
    Ok(Json(resp))
}

pub async fn list_families(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<FamilyResponse>>, AppError> {
    let resp = services::family::list_families(&state.pool, auth.user_id).await?;
    Ok(Json(resp))
}

pub async fn get_family_detail(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<FamilyDetailResponse>, AppError> {
    let resp = services::family::get_family_detail(&state.pool, auth.user_id, id).await?;
    Ok(Json(resp))
}

pub async fn join_family(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<JoinFamilyRequest>,
) -> Result<Json<FamilyResponse>, AppError> {
    let resp = services::family::join_family(&state.pool, auth.user_id, req).await?;
    Ok(Json(resp))
}

pub async fn leave_family(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<(), AppError> {
    services::family::leave_family(&state.pool, auth.user_id, id).await
}

pub async fn switch_default_family(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<SwitchFamilyRequest>,
) -> Result<(), AppError> {
    services::family::switch_default_family(&state.pool, auth.user_id, req).await
}

pub async fn regenerate_invite_code(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let code = services::family::regenerate_invite_code(&state.pool, auth.user_id, id).await?;
    Ok(Json(serde_json::json!({ "invite_code": code })))
}
