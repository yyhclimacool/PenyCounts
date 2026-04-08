use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{CreateMemberRequest, Member};
use crate::services;

pub async fn list_members(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<Member>>, AppError> {
    let members = services::member::list_members(&state.pool, auth.user_id).await?;
    Ok(Json(members))
}

pub async fn get_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Member>, AppError> {
    let member = services::member::get_member(&state.pool, auth.user_id, id).await?;
    Ok(Json(member))
}

pub async fn create_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateMemberRequest>,
) -> Result<(StatusCode, Json<Member>), AppError> {
    let member = services::member::create_member(&state.pool, auth.user_id, req).await?;
    Ok((StatusCode::CREATED, Json(member)))
}

pub async fn update_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateMemberRequest>,
) -> Result<Json<Member>, AppError> {
    let member =
        services::member::update_member(&state.pool, auth.user_id, id, req).await?;
    Ok(Json(member))
}

pub async fn delete_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    services::member::delete_member(&state.pool, auth.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
