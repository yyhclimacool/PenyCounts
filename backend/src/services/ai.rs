use axum::response::sse::Event;
use chrono::Utc;
use futures::StreamExt;
use sqlx::PgPool;
use std::convert::Infallible;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{Category, ChatMessage, LlmConfig, LlmConfigRequest};

// ── LLM config CRUD ──────────────────────────────────────────────────

pub async fn get_llm_configs(pool: &PgPool, user_id: Uuid) -> Result<Vec<LlmConfig>, AppError> {
    tracing::debug!(user_id = %user_id, "svc::get_llm_configs: querying");
    let configs = sqlx::query_as::<_, LlmConfig>(
        "SELECT * FROM llm_configs WHERE user_id = $1 ORDER BY is_active DESC, provider",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(count = configs.len(), "svc::get_llm_configs: done");

    Ok(configs)
}

pub async fn create_llm_config(
    pool: &PgPool,
    user_id: Uuid,
    req: LlmConfigRequest,
) -> Result<LlmConfig, AppError> {
    tracing::debug!(user_id = %user_id, provider = %req.provider, model = %req.model_name, "svc::create_llm_config: deactivating old configs");
    sqlx::query("UPDATE llm_configs SET is_active = false WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;

    tracing::debug!("svc::create_llm_config: inserting new config");
    let config = sqlx::query_as::<_, LlmConfig>(
        "INSERT INTO llm_configs (id, user_id, provider, api_url, api_key, model_name, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&req.provider)
    .bind(&req.api_url)
    .bind(&req.api_key)
    .bind(&req.model_name)
    .fetch_one(pool)
    .await?;
    tracing::debug!(config_id = %config.id, "svc::create_llm_config: inserted");

    Ok(config)
}

pub async fn update_llm_config(
    pool: &PgPool,
    user_id: Uuid,
    config_id: Uuid,
    req: LlmConfigRequest,
) -> Result<LlmConfig, AppError> {
    tracing::debug!(user_id = %user_id, config_id = %config_id, provider = %req.provider, model = %req.model_name, "svc::update_llm_config: executing UPDATE");
    let config = sqlx::query_as::<_, LlmConfig>(
        "UPDATE llm_configs
         SET provider = $1, api_url = $2, api_key = $3, model_name = $4
         WHERE id = $5 AND user_id = $6
         RETURNING *",
    )
    .bind(&req.provider)
    .bind(&req.api_url)
    .bind(&req.api_key)
    .bind(&req.model_name)
    .bind(config_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        tracing::debug!(config_id = %config_id, "svc::update_llm_config: not found");
        AppError::NotFound("LLM config not found".to_string())
    })?;
    tracing::debug!(config_id = %config.id, "svc::update_llm_config: updated");

    Ok(config)
}

pub async fn set_active_llm_config(
    pool: &PgPool,
    user_id: Uuid,
    config_id: Uuid,
) -> Result<(), AppError> {
    tracing::debug!(user_id = %user_id, config_id = %config_id, "svc::set_active_llm_config: deactivating all");
    sqlx::query("UPDATE llm_configs SET is_active = false WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;

    tracing::debug!("svc::set_active_llm_config: activating target");
    let result = sqlx::query(
        "UPDATE llm_configs SET is_active = true WHERE id = $1 AND user_id = $2",
    )
    .bind(config_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    tracing::debug!(rows_affected = result.rows_affected(), "svc::set_active_llm_config: done");
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("LLM config not found".to_string()));
    }

    Ok(())
}

pub async fn delete_llm_config(
    pool: &PgPool,
    user_id: Uuid,
    config_id: Uuid,
) -> Result<(), AppError> {
    tracing::debug!(user_id = %user_id, config_id = %config_id, "svc::delete_llm_config: executing DELETE");
    let result =
        sqlx::query("DELETE FROM llm_configs WHERE id = $1 AND user_id = $2")
            .bind(config_id)
            .bind(user_id)
            .execute(pool)
            .await?;

    tracing::debug!(rows_affected = result.rows_affected(), "svc::delete_llm_config: done");
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("LLM config not found".to_string()));
    }

    Ok(())
}

// ── Chat with streaming ──────────────────────────────────────────────

pub async fn get_chat_history(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<ChatMessage>, AppError> {
    tracing::debug!(user_id = %user_id, "svc::get_chat_history: querying");
    let messages = sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM chat_messages WHERE user_id = $1 ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(count = messages.len(), "svc::get_chat_history: done");

    Ok(messages)
}

pub async fn clear_chat_history(pool: &PgPool, user_id: Uuid) -> Result<(), AppError> {
    tracing::debug!(user_id = %user_id, "svc::clear_chat_history: deleting");
    let result = sqlx::query("DELETE FROM chat_messages WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    tracing::debug!(rows_deleted = result.rows_affected(), "svc::clear_chat_history: done");
    Ok(())
}

pub async fn chat_stream(
    pool: &PgPool,
    user_id: Uuid,
    message: String,
) -> Result<impl futures::Stream<Item = Result<Event, Infallible>>, AppError> {
    tracing::debug!(user_id = %user_id, message_len = message.len(), "svc::chat_stream: starting");

    tracing::debug!("svc::chat_stream: loading active LLM config");
    let llm_config = sqlx::query_as::<_, LlmConfig>(
        "SELECT * FROM llm_configs WHERE user_id = $1 AND is_active = true LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        tracing::debug!(user_id = %user_id, "svc::chat_stream: no active LLM config");
        AppError::BadRequest("No active LLM configuration. Please configure one first.".to_string())
    })?;
    tracing::debug!(
        provider = %llm_config.provider,
        model = %llm_config.model_name,
        api_url = %llm_config.api_url,
        "svc::chat_stream: LLM config loaded"
    );

    tracing::debug!("svc::chat_stream: saving user message to chat_messages");
    sqlx::query(
        "INSERT INTO chat_messages (id, user_id, role, content, created_at)
         VALUES ($1, $2, 'user', $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&message)
    .bind(Utc::now())
    .execute(pool)
    .await?;

    tracing::debug!("svc::chat_stream: loading categories for system prompt");
    let categories = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE user_id IS NULL OR user_id = $1 ORDER BY type, sort_order",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(categories = categories.len(), "svc::chat_stream: categories loaded");

    let category_list: String = categories
        .iter()
        .map(|c| format!("- {} ({}, icon: {})", c.name, c.r#type, c.icon))
        .collect::<Vec<_>>()
        .join("\n");

    let system_prompt = format!(
        "你是 PenyCounts 家庭记账应用的 AI 助手。你可以帮助用户记录收支、分析消费习惯、管理财务。\n\n\
         用户可用的分类:\n{}\n\n\
         你可以帮助:\n\
         1. 记录新的交易（收入/支出）\n\
         2. 查询消费数据\n\
         3. 提供理财建议\n\
         4. 分析消费模式\n\n\
         当用户想要记账时，请提取以下信息：类型(income/expense)、金额、分类、日期、备注。\n\
         用 JSON 格式返回记账信息，格式如:\n\
         ```json\n\
         {{\"action\": \"create_transaction\", \"type\": \"expense\", \"amount\": 50.00, \"category\": \"餐饮\", \"date\": \"2024-01-15\", \"note\": \"午餐\"}}\n\
         ```",
        category_list
    );

    tracing::debug!("svc::chat_stream: loading recent chat history");
    let history = sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM chat_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(history_count = history.len(), "svc::chat_stream: history loaded");

    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": system_prompt,
    })];

    for msg in history.into_iter().rev() {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    let tools = serde_json::json!([
        {
            "type": "function",
            "function": {
                "name": "create_transaction",
                "description": "创建一条新的收支记录",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "type": { "type": "string", "enum": ["income", "expense"] },
                        "amount": { "type": "number" },
                        "category_name": { "type": "string" },
                        "date": { "type": "string", "format": "date" },
                        "note": { "type": "string" }
                    },
                    "required": ["type", "amount", "category_name", "date"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "query_transactions",
                "description": "查询用户的交易记录",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "start_date": { "type": "string", "format": "date" },
                        "end_date": { "type": "string", "format": "date" },
                        "type": { "type": "string", "enum": ["income", "expense"] },
                        "category_name": { "type": "string" }
                    }
                }
            }
        }
    ]);

    let api_key = llm_config.api_key.unwrap_or_default();

    let request_body = serde_json::json!({
        "model": llm_config.model_name,
        "messages": messages,
        "stream": true,
        "tools": tools,
    });

    tracing::debug!(
        model = %llm_config.model_name,
        api_url = %llm_config.api_url,
        message_count = messages.len(),
        "svc::chat_stream: sending request to LLM"
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&llm_config.api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "svc::chat_stream: LLM request failed");
            AppError::Internal(format!("LLM request failed: {}", e))
        })?;

    let status = response.status();
    tracing::debug!(status = %status, "svc::chat_stream: LLM response status");

    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown".to_string());
        tracing::error!(status = %status, body = %body, "svc::chat_stream: LLM API error");
        return Err(AppError::Internal(format!(
            "LLM API returned {}: {}",
            status, body
        )));
    }

    tracing::debug!("svc::chat_stream: starting SSE stream processing");
    let pool_clone = pool.clone();
    let user_id_clone = user_id;

    let stream = async_stream::stream! {
        let mut full_response = String::new();
        let mut byte_stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut chunk_count: u32 = 0;

        while let Some(chunk) = byte_stream.next().await {
            match chunk {
                Ok(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    chunk_count += 1;

                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..pos].trim().to_string();
                        buffer = buffer[pos + 1..].to_string();

                        if line.is_empty() {
                            continue;
                        }

                        if line == "data: [DONE]" {
                            tracing::debug!(chunks = chunk_count, response_len = full_response.len(), "svc::chat_stream: stream completed");
                            yield Ok(Event::default().data("[DONE]"));
                            continue;
                        }

                        if let Some(data) = line.strip_prefix("data: ") {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                                    if !content.is_empty() {
                                        full_response.push_str(content);
                                        yield Ok(Event::default().data(content));
                                    }
                                }

                                if let Some(tool_calls) = parsed["choices"][0]["delta"]["tool_calls"].as_array() {
                                    for tc in tool_calls {
                                        if let Some(func) = tc.get("function") {
                                            let tc_json = serde_json::to_string(func).unwrap_or_default();
                                            tracing::debug!(tool_call = %tc_json, "svc::chat_stream: received tool call");
                                            yield Ok(Event::default().event("tool_call").data(tc_json));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "svc::chat_stream: stream error");
                    yield Ok(Event::default().event("error").data(e.to_string()));
                    break;
                }
            }
        }

        if !full_response.is_empty() {
            tracing::debug!(response_len = full_response.len(), "svc::chat_stream: saving assistant response");
            let _ = sqlx::query(
                "INSERT INTO chat_messages (id, user_id, role, content, created_at)
                 VALUES ($1, $2, 'assistant', $3, $4)",
            )
            .bind(Uuid::new_v4())
            .bind(user_id_clone)
            .bind(&full_response)
            .bind(Utc::now())
            .execute(&pool_clone)
            .await;
        }
    };

    Ok(stream)
}
