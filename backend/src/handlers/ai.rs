use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::sse::{KeepAlive, Sse},
    Json,
};
use base64::Engine;
use std::time::Duration;
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{
    AiReport, AiReportSummary, ChatMessage, ChatRequest, LlmConfig, LlmConfigRequest,
    OcrAvailability, OcrResult, ReportRequest, SaveReportRequest,
};
use crate::services;

pub async fn list_configs(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<LlmConfig>>, AppError> {
    tracing::debug!(user_id = %auth.family_id, "list_configs: received request");
    let configs = services::ai::get_llm_configs(&state.pool, auth.family_id).await?;
    tracing::debug!(user_id = %auth.family_id, count = configs.len(), "list_configs: returning configs");
    Ok(Json(configs))
}

pub async fn get_active_config(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<LlmConfig>, AppError> {
    tracing::debug!(user_id = %auth.family_id, "get_active_config: received request");
    let configs = services::ai::get_llm_configs(&state.pool, auth.family_id).await?;
    let active = configs.into_iter().find(|c| c.is_active)
        .ok_or_else(|| AppError::NotFound("No active LLM config".to_string()))?;
    tracing::debug!(user_id = %auth.family_id, config_id = %active.id, model = %active.model_name, "get_active_config: returning active config");
    Ok(Json(active))
}

pub async fn upsert_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<LlmConfigRequest>,
) -> Result<Json<LlmConfig>, AppError> {
    tracing::debug!(user_id = %auth.family_id, ?req, "upsert_config: received request");
    let configs = services::ai::get_llm_configs(&state.pool, auth.family_id).await?;
    let config = if let Some(existing) = configs.into_iter().find(|c| c.is_active) {
        tracing::debug!(config_id = %existing.id, "upsert_config: updating existing active config");
        services::ai::update_llm_config(&state.pool, auth.family_id, existing.id, req).await?
    } else {
        tracing::debug!("upsert_config: no active config found, creating new one");
        services::ai::create_llm_config(&state.pool, auth.user_id, auth.family_id, req).await?
    };
    tracing::info!(config_id = %config.id, model = %config.model_name, "upsert_config: config saved");
    Ok(Json(config))
}

pub async fn create_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<LlmConfigRequest>,
) -> Result<(StatusCode, Json<LlmConfig>), AppError> {
    tracing::debug!(user_id = %auth.family_id, ?req, "create_config: received request");
    let config = services::ai::create_llm_config(&state.pool, auth.user_id, auth.family_id, req).await?;
    tracing::info!(config_id = %config.id, model = %config.model_name, "create_config: created successfully");
    Ok((StatusCode::CREATED, Json(config)))
}

pub async fn update_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<LlmConfigRequest>,
) -> Result<Json<LlmConfig>, AppError> {
    tracing::debug!(user_id = %auth.family_id, config_id = %id, ?req, "update_config: received request");
    let config =
        services::ai::update_llm_config(&state.pool, auth.family_id, id, req).await?;
    tracing::info!(config_id = %config.id, model = %config.model_name, "update_config: updated successfully");
    Ok(Json(config))
}

pub async fn delete_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    tracing::debug!(user_id = %auth.family_id, config_id = %id, "delete_config: received request");
    services::ai::delete_llm_config(&state.pool, auth.family_id, id).await?;
    tracing::info!(config_id = %id, "delete_config: deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn activate_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    tracing::debug!(user_id = %auth.family_id, config_id = %id, "activate_config: received request");
    services::ai::set_active_llm_config(&state.pool, auth.family_id, id).await?;
    tracing::info!(config_id = %id, "activate_config: config activated");
    Ok(Json(serde_json::json!({ "message": "Config activated" })))
}

pub async fn chat(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ChatRequest>,
) -> Result<Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>>, AppError>
{
    tracing::debug!(user_id = %auth.family_id, message_len = req.message.len(), "chat: received request");
    tracing::debug!(user_id = %auth.family_id, message = %req.message, "chat: message content");
    let stream =
        services::ai::chat_stream(&state.pool, auth.user_id, auth.family_id, req.message).await?;
    tracing::debug!(user_id = %auth.family_id, "chat: SSE stream created");
    // Reasoning models can think for a long time without emitting any visible
    // content. Send a periodic keep-alive comment so reverse proxies (nginx
    // proxy_read_timeout) don't drop the idle connection mid-thinking.
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))))
}

pub async fn report(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ReportRequest>,
) -> Result<Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>>, AppError>
{
    tracing::debug!(user_id = %auth.family_id, period = %req.period, year = req.year, month = ?req.month, "report: received request");
    let stream = services::ai::report_stream(
        &state.pool,
        auth.family_id,
        req.period,
        req.year,
        req.month,
    )
    .await?;
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))))
}

pub async fn save_report(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<SaveReportRequest>,
) -> Result<(StatusCode, Json<AiReport>), AppError> {
    let report =
        services::ai::save_report(&state.pool, auth.user_id, auth.family_id, req).await?;
    Ok((StatusCode::CREATED, Json(report)))
}

pub async fn list_reports(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<AiReportSummary>>, AppError> {
    let reports = services::ai::list_reports(&state.pool, auth.family_id).await?;
    Ok(Json(reports))
}

pub async fn get_report(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AiReport>, AppError> {
    let report = services::ai::get_report(&state.pool, auth.family_id, id).await?;
    Ok(Json(report))
}

pub async fn delete_report(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    services::ai::delete_report(&state.pool, auth.family_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn ocr_availability(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<OcrAvailability>, AppError> {
    let data = services::ai::ocr_availability(&state.pool, auth.family_id).await?;
    Ok(Json(data))
}

pub async fn ocr(
    State(state): State<AppState>,
    auth: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<OcrResult>, AppError> {
    let mut data_url: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("读取上传内容失败: {e}")))?
    {
        if field.name() == Some("file") {
            let content_type = field
                .content_type()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "image/jpeg".to_string());
            let bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(format!("读取图片失败: {e}")))?;
            if bytes.is_empty() {
                return Err(AppError::BadRequest("图片为空".to_string()));
            }
            // Guard against oversized uploads (~10 MB).
            if bytes.len() > 10 * 1024 * 1024 {
                return Err(AppError::BadRequest("图片过大，请压缩后重试".to_string()));
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            data_url = Some(format!("data:{content_type};base64,{encoded}"));
        }
    }

    let data_url = data_url
        .ok_or_else(|| AppError::BadRequest("缺少图片文件 (file)".to_string()))?;

    let result = services::ai::ocr_extract(&state.pool, auth.family_id, data_url).await?;
    Ok(Json(result))
}

pub async fn chat_history(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ChatMessage>>, AppError> {
    tracing::debug!(user_id = %auth.family_id, "chat_history: received request");
    let history = services::ai::get_chat_history(&state.pool, auth.family_id).await?;
    tracing::debug!(user_id = %auth.family_id, count = history.len(), "chat_history: returning messages");
    Ok(Json(history))
}

pub async fn clear_history(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<StatusCode, AppError> {
    tracing::debug!(user_id = %auth.family_id, "clear_history: received request");
    services::ai::clear_chat_history(&state.pool, auth.family_id).await?;
    tracing::info!(user_id = %auth.family_id, "clear_history: history cleared");
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Deserialize)]
pub struct TestConnectionRequest {
    pub api_url: String,
    pub api_key: Option<String>,
    pub model_name: String,
}

pub async fn test_connection(
    _auth: AuthUser,
    Json(req): Json<TestConnectionRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    tracing::debug!(api_url = %req.api_url, model = %req.model_name, "test_connection: received request");
    let result = services::ai::test_llm_connection(&req.api_url, req.api_key.as_deref(), &req.model_name).await;
    match result {
        Ok(reply) => {
            tracing::info!(model = %req.model_name, "test_connection: success");
            Ok(Json(serde_json::json!({ "success": true, "reply": reply })))
        }
        Err(err) => {
            tracing::warn!(model = %req.model_name, error = %err, "test_connection: failed");
            Ok(Json(serde_json::json!({ "success": false, "error": err })))
        }
    }
}
