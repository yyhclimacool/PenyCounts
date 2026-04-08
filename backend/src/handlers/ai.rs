use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::sse::Sse,
    Json,
};
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{ChatMessage, ChatRequest, LlmConfig, LlmConfigRequest};
use crate::services;

pub async fn list_configs(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<LlmConfig>>, AppError> {
    let configs = services::ai::get_llm_configs(&state.pool, auth.user_id).await?;
    Ok(Json(configs))
}

pub async fn create_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<LlmConfigRequest>,
) -> Result<(StatusCode, Json<LlmConfig>), AppError> {
    let config = services::ai::create_llm_config(&state.pool, auth.user_id, req).await?;
    Ok((StatusCode::CREATED, Json(config)))
}

pub async fn update_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<LlmConfigRequest>,
) -> Result<Json<LlmConfig>, AppError> {
    let config =
        services::ai::update_llm_config(&state.pool, auth.user_id, id, req).await?;
    Ok(Json(config))
}

pub async fn delete_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    services::ai::delete_llm_config(&state.pool, auth.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn activate_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    services::ai::set_active_llm_config(&state.pool, auth.user_id, id).await?;
    Ok(Json(serde_json::json!({ "message": "Config activated" })))
}

pub async fn chat(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ChatRequest>,
) -> Result<Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>>, AppError>
{
    let stream =
        services::ai::chat_stream(&state.pool, auth.user_id, req.message).await?;
    Ok(Sse::new(stream))
}

pub async fn chat_history(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ChatMessage>>, AppError> {
    let history = services::ai::get_chat_history(&state.pool, auth.user_id).await?;
    Ok(Json(history))
}

pub async fn clear_history(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<StatusCode, AppError> {
    services::ai::clear_chat_history(&state.pool, auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
