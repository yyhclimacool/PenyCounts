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
    tracing::debug!(user_id = %auth.user_id, "list_members: received request");
    let members = services::member::list_members(&state.pool, auth.user_id).await?;
    tracing::debug!(user_id = %auth.user_id, count = members.len(), "list_members: returning members");
    Ok(Json(members))
}

pub async fn get_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Member>, AppError> {
    tracing::debug!(user_id = %auth.user_id, member_id = %id, "get_member: received request");
    let member = services::member::get_member(&state.pool, auth.user_id, id).await?;
    tracing::debug!(member_id = %id, name = %member.name, "get_member: returning member");
    Ok(Json(member))
}

pub async fn create_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateMemberRequest>,
) -> Result<(StatusCode, Json<Member>), AppError> {
    tracing::debug!(user_id = %auth.user_id, ?req, "create_member: received request");
    let member = services::member::create_member(&state.pool, auth.user_id, req).await?;
    tracing::info!(member_id = %member.id, name = %member.name, "create_member: created successfully");
    Ok((StatusCode::CREATED, Json(member)))
}

pub async fn update_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateMemberRequest>,
) -> Result<Json<Member>, AppError> {
    tracing::debug!(user_id = %auth.user_id, member_id = %id, ?req, "update_member: received request");
    let member =
        services::member::update_member(&state.pool, auth.user_id, id, req).await?;
    tracing::info!(member_id = %member.id, name = %member.name, "update_member: updated successfully");
    Ok(Json(member))
}

pub async fn delete_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    tracing::debug!(user_id = %auth.user_id, member_id = %id, "delete_member: received request");
    services::member::delete_member(&state.pool, auth.user_id, id).await?;
    tracing::info!(member_id = %id, "delete_member: deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}
