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
    tracing::debug!(user_id = %auth.user_id, "list_configs: received request");
    let configs = services::ai::get_llm_configs(&state.pool, auth.user_id).await?;
    tracing::debug!(user_id = %auth.user_id, count = configs.len(), "list_configs: returning configs");
    Ok(Json(configs))
}

pub async fn get_active_config(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<LlmConfig>, AppError> {
    tracing::debug!(user_id = %auth.user_id, "get_active_config: received request");
    let configs = services::ai::get_llm_configs(&state.pool, auth.user_id).await?;
    let active = configs.into_iter().find(|c| c.is_active)
        .ok_or_else(|| AppError::NotFound("No active LLM config".to_string()))?;
    tracing::debug!(user_id = %auth.user_id, config_id = %active.id, model = %active.model_name, "get_active_config: returning active config");
    Ok(Json(active))
}

pub async fn upsert_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<LlmConfigRequest>,
) -> Result<Json<LlmConfig>, AppError> {
    tracing::debug!(user_id = %auth.user_id, ?req, "upsert_config: received request");
    let configs = services::ai::get_llm_configs(&state.pool, auth.user_id).await?;
    let config = if let Some(existing) = configs.into_iter().find(|c| c.is_active) {
        tracing::debug!(config_id = %existing.id, "upsert_config: updating existing active config");
        services::ai::update_llm_config(&state.pool, auth.user_id, existing.id, req).await?
    } else {
        tracing::debug!("upsert_config: no active config found, creating new one");
        services::ai::create_llm_config(&state.pool, auth.user_id, req).await?
    };
    tracing::info!(config_id = %config.id, model = %config.model_name, "upsert_config: config saved");
    Ok(Json(config))
}

pub async fn create_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<LlmConfigRequest>,
) -> Result<(StatusCode, Json<LlmConfig>), AppError> {
    tracing::debug!(user_id = %auth.user_id, ?req, "create_config: received request");
    let config = services::ai::create_llm_config(&state.pool, auth.user_id, req).await?;
    tracing::info!(config_id = %config.id, model = %config.model_name, "create_config: created successfully");
    Ok((StatusCode::CREATED, Json(config)))
}

pub async fn update_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<LlmConfigRequest>,
) -> Result<Json<LlmConfig>, AppError> {
    tracing::debug!(user_id = %auth.user_id, config_id = %id, ?req, "update_config: received request");
    let config =
        services::ai::update_llm_config(&state.pool, auth.user_id, id, req).await?;
    tracing::info!(config_id = %config.id, model = %config.model_name, "update_config: updated successfully");
    Ok(Json(config))
}

pub async fn delete_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    tracing::debug!(user_id = %auth.user_id, config_id = %id, "delete_config: received request");
    services::ai::delete_llm_config(&state.pool, auth.user_id, id).await?;
    tracing::info!(config_id = %id, "delete_config: deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn activate_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    tracing::debug!(user_id = %auth.user_id, config_id = %id, "activate_config: received request");
    services::ai::set_active_llm_config(&state.pool, auth.user_id, id).await?;
    tracing::info!(config_id = %id, "activate_config: config activated");
    Ok(Json(serde_json::json!({ "message": "Config activated" })))
}

pub async fn chat(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ChatRequest>,
) -> Result<Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>>, AppError>
{
    tracing::debug!(user_id = %auth.user_id, message_len = req.message.len(), "chat: received request");
    tracing::debug!(user_id = %auth.user_id, message = %req.message, "chat: message content");
    let stream =
        services::ai::chat_stream(&state.pool, auth.user_id, req.message).await?;
    tracing::debug!(user_id = %auth.user_id, "chat: SSE stream created");
    Ok(Sse::new(stream))
}

pub async fn chat_history(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ChatMessage>>, AppError> {
    tracing::debug!(user_id = %auth.user_id, "chat_history: received request");
    let history = services::ai::get_chat_history(&state.pool, auth.user_id).await?;
    tracing::debug!(user_id = %auth.user_id, count = history.len(), "chat_history: returning messages");
    Ok(Json(history))
}

pub async fn clear_history(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<StatusCode, AppError> {
    tracing::debug!(user_id = %auth.user_id, "clear_history: received request");
    services::ai::clear_chat_history(&state.pool, auth.user_id).await?;
    tracing::info!(user_id = %auth.user_id, "clear_history: history cleared");
    Ok(StatusCode::NO_CONTENT)
}
