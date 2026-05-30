use axum::response::sse::Event;
use chrono::{Local, NaiveDate, NaiveTime, Utc};
use futures::StreamExt;
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::convert::Infallible;
use std::str::FromStr;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    Category, ChatMessage, CreateTransactionRequest, LlmConfig, LlmConfigRequest, Member,
    Subcategory,
};
use crate::services::transaction;

// ── LLM config CRUD ──────────────────────────────────────────────────

pub async fn get_llm_configs(pool: &PgPool, family_id: Uuid) -> Result<Vec<LlmConfig>, AppError> {
    tracing::debug!(family_id = %family_id, "svc::get_llm_configs: querying");
    let configs = sqlx::query_as::<_, LlmConfig>(
        "SELECT * FROM llm_configs WHERE family_id = $1 ORDER BY is_active DESC, provider",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(count = configs.len(), "svc::get_llm_configs: done");

    Ok(configs)
}

pub async fn create_llm_config(
    pool: &PgPool,
    family_id: Uuid,
    req: LlmConfigRequest,
) -> Result<LlmConfig, AppError> {
    tracing::debug!(family_id = %family_id, provider = %req.provider, model = %req.model_name, "svc::create_llm_config: deactivating old configs");
    sqlx::query("UPDATE llm_configs SET is_active = false WHERE family_id = $1")
        .bind(family_id)
        .execute(pool)
        .await?;

    tracing::debug!("svc::create_llm_config: inserting new config");
    let config = sqlx::query_as::<_, LlmConfig>(
        "INSERT INTO llm_configs (id, user_id, family_id, provider, api_url, api_key, model_name, is_active)
         VALUES ($1, $1, $2, $3, $4, $5, $6, true)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(family_id)
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
    family_id: Uuid,
    config_id: Uuid,
    req: LlmConfigRequest,
) -> Result<LlmConfig, AppError> {
    tracing::debug!(family_id = %family_id, config_id = %config_id, provider = %req.provider, model = %req.model_name, "svc::update_llm_config: executing UPDATE");
    let config = sqlx::query_as::<_, LlmConfig>(
        "UPDATE llm_configs
         SET provider = $1, api_url = $2, api_key = $3, model_name = $4
         WHERE id = $5 AND family_id = $6
         RETURNING *",
    )
    .bind(&req.provider)
    .bind(&req.api_url)
    .bind(&req.api_key)
    .bind(&req.model_name)
    .bind(config_id)
    .bind(family_id)
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
    family_id: Uuid,
    config_id: Uuid,
) -> Result<(), AppError> {
    tracing::debug!(family_id = %family_id, config_id = %config_id, "svc::set_active_llm_config: deactivating all");
    sqlx::query("UPDATE llm_configs SET is_active = false WHERE family_id = $1")
        .bind(family_id)
        .execute(pool)
        .await?;

    tracing::debug!("svc::set_active_llm_config: activating target");
    let result = sqlx::query(
        "UPDATE llm_configs SET is_active = true WHERE id = $1 AND family_id = $2",
    )
    .bind(config_id)
    .bind(family_id)
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
    family_id: Uuid,
    config_id: Uuid,
) -> Result<(), AppError> {
    tracing::debug!(family_id = %family_id, config_id = %config_id, "svc::delete_llm_config: executing DELETE");
    let result =
        sqlx::query("DELETE FROM llm_configs WHERE id = $1 AND family_id = $2")
            .bind(config_id)
            .bind(family_id)
            .execute(pool)
            .await?;

    tracing::debug!(rows_affected = result.rows_affected(), "svc::delete_llm_config: done");
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("LLM config not found".to_string()));
    }

    Ok(())
}

// ── Test connection ──────────────────────────────────────────────────

pub async fn test_llm_connection(
    api_url: &str,
    api_key: Option<&str>,
    model_name: &str,
) -> Result<String, String> {
    let request_body = serde_json::json!({
        "model": model_name,
        "messages": [
            { "role": "user", "content": "Hi, reply with one word to confirm you are working." }
        ],
        "max_tokens": 20,
        "stream": false,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建请求客户端失败: {}", e))?;

    let mut req = client
        .post(api_url)
        .header("Content-Type", "application/json");

    if let Some(key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }

    let response = req
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "请求超时（15秒），请检查 API 地址是否可访问".to_string()
            } else if e.is_connect() {
                format!("无法连接到 {}，请检查地址是否正确", api_url)
            } else {
                format!("请求失败: {}", e)
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API 返回错误 ({}): {}", status.as_u16(), body));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let reply = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    if reply.is_empty() {
        return Err("模型返回了空响应，请检查模型名称是否正确".to_string());
    }

    Ok(reply)
}

// ── Chat with streaming ──────────────────────────────────────────────

pub async fn get_chat_history(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<Vec<ChatMessage>, AppError> {
    tracing::debug!(family_id = %family_id, "svc::get_chat_history: querying");
    let messages = sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM chat_messages WHERE family_id = $1 ORDER BY created_at ASC",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(count = messages.len(), "svc::get_chat_history: done");

    Ok(messages)
}

pub async fn clear_chat_history(pool: &PgPool, family_id: Uuid) -> Result<(), AppError> {
    tracing::debug!(family_id = %family_id, "svc::clear_chat_history: deleting");
    let result = sqlx::query("DELETE FROM chat_messages WHERE family_id = $1")
        .bind(family_id)
        .execute(pool)
        .await?;
    tracing::debug!(rows_deleted = result.rows_affected(), "svc::clear_chat_history: done");
    Ok(())
}

pub async fn chat_stream(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    message: String,
) -> Result<impl futures::Stream<Item = Result<Event, Infallible>>, AppError> {
    tracing::debug!(family_id = %family_id, message_len = message.len(), "svc::chat_stream: starting");

    let llm_config = sqlx::query_as::<_, LlmConfig>(
        "SELECT * FROM llm_configs WHERE family_id = $1 AND is_active = true LIMIT 1",
    )
    .bind(family_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::BadRequest("No active LLM configuration. Please configure one first.".to_string())
    })?;

    sqlx::query(
        "INSERT INTO chat_messages (id, user_id, family_id, role, content, created_at)
         VALUES ($1, $1, $2, 'user', $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(family_id)
    .bind(&message)
    .bind(Utc::now())
    .execute(pool)
    .await?;

    let categories = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE user_id IS NULL OR family_id = $1 ORDER BY type, sort_order",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;

    let subcategories = sqlx::query_as::<_, Subcategory>(
        "SELECT s.* FROM subcategories s
         JOIN categories c ON s.category_id = c.id
         WHERE c.user_id IS NULL OR c.family_id = $1
         ORDER BY s.sort_order",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;

    let members = sqlx::query_as::<_, Member>(
        "SELECT * FROM members WHERE family_id = $1 ORDER BY name",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;

    let mut category_list = String::new();
    for cat in &categories {
        category_list.push_str(&format!("- {} ({})\n", cat.name, cat.r#type));
        let subs: Vec<&Subcategory> = subcategories
            .iter()
            .filter(|s| s.category_id == cat.id)
            .collect();
        for sub in subs {
            category_list.push_str(&format!("  - {}\n", sub.name));
        }
    }

    let member_list: String = if members.is_empty() {
        "暂无".to_string()
    } else {
        members.iter().map(|m| m.name.as_str()).collect::<Vec<_>>().join("、")
    };

    let now = Local::now();
    let system_prompt = format!(
        "你是 PenyCounts 家庭记账应用的 AI 助手。你的主要职责是帮助用户通过自然语言快速记账。\n\n\
         当前时间: {now}\n\n\
         ## 可用分类（含子分类）:\n{category_list}\n\
         ## 已有家庭成员:\n{member_list}\n\n\
         ## 记账规则:\n\
         当用户描述一笔交易时，你需要提取以下信息并调用 create_transaction 工具：\n\
         - **type** (必须): income 或 expense，根据语义判断\n\
         - **amount** (必须): 金额数字\n\
         - **category_name** (必须): 从上面的分类中选择最匹配的一级分类名称\n\
         - **subcategory_name** (可选): 从对应分类的子分类中选择最匹配的\n\
         - **date** (必须): 日期，格式 YYYY-MM-DD。如果用户说「今天」就是 {today}，「昨天」就是前一天，以此类推\n\
         - **time** (可选): 时间，格式 HH:MM:SS。如果用户提到「中午」约12:00:00，「晚上」约19:00:00等\n\
         - **currency** (可选): 币种代码，默认 CNY\n\
         - **members** (可选): 涉及的人员名称列表。如果用户提到「和某某一起」，把相关人员都列出\n\
         - **note** (可选): 备注信息\n\n\
         ## 重要行为准则:\n\
         1. 如果用户的描述中缺少 type 或 amount，你必须追问用户，不要猜测\n\
         2. 如果缺少 category_name，根据上下文推断最可能的分类；如果无法推断，追问用户\n\
         3. 如果缺少 date，默认使用今天 ({today})\n\
         4. 成功创建交易后，用简洁的格式确认，包括: 类型、金额、分类、日期等关键信息\n\
         5. 不要在回复中输出 JSON，直接调用工具即可\n\
         6. 如果用户只是在闲聊或问问题，正常回答，不要强行记账\n\
         7. 当用户询问消费统计或账单查询时，使用 query_transactions 工具查询数据，然后根据结果回答用户问题\n\
         8. 查询时根据用户意图选择合适的时间范围。「最近一个月」从 {one_month_ago} 到 {today}，「本月」从本月1号到今天",
        now = now.format("%Y-%m-%d %H:%M:%S"),
        category_list = category_list.trim(),
        member_list = member_list,
        today = now.format("%Y-%m-%d"),
        one_month_ago = (now - chrono::Duration::days(30)).format("%Y-%m-%d"),
    );

    let history = sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM chat_messages WHERE family_id = $1 ORDER BY created_at DESC LIMIT 20",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;

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
                "description": "创建一条新的收支记录。当用户描述了一笔明确的收入或支出时调用此工具。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["income", "expense"],
                            "description": "交易类型：income=收入, expense=支出"
                        },
                        "amount": {
                            "type": "number",
                            "description": "金额（正数）"
                        },
                        "category_name": {
                            "type": "string",
                            "description": "一级分类名称，必须从可用分类中选择"
                        },
                        "subcategory_name": {
                            "type": "string",
                            "description": "二级分类名称（可选），必须属于对应的一级分类"
                        },
                        "date": {
                            "type": "string",
                            "format": "date",
                            "description": "日期，格式 YYYY-MM-DD"
                        },
                        "time": {
                            "type": "string",
                            "description": "时间，格式 HH:MM:SS（可选，默认当前时间）"
                        },
                        "currency": {
                            "type": "string",
                            "description": "币种代码（可选，默认 CNY）"
                        },
                        "members": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "涉及的人员姓名列表（可选）"
                        },
                        "note": {
                            "type": "string",
                            "description": "备注信息（可选）"
                        }
                    },
                    "required": ["type", "amount", "category_name", "date"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "query_transactions",
                "description": "查询用户的交易记录。用于回答用户关于消费统计、支出分析等问题。返回指定时间范围内的交易明细。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "start_date": {
                            "type": "string",
                            "format": "date",
                            "description": "查询起始日期（含），格式 YYYY-MM-DD"
                        },
                        "end_date": {
                            "type": "string",
                            "format": "date",
                            "description": "查询结束日期（含），格式 YYYY-MM-DD"
                        },
                        "type": {
                            "type": "string",
                            "enum": ["income", "expense"],
                            "description": "筛选交易类型（可选）"
                        },
                        "category_name": {
                            "type": "string",
                            "description": "筛选一级分类名称（可选）"
                        },
                        "member_name": {
                            "type": "string",
                            "description": "筛选涉及的成员姓名（可选）"
                        }
                    },
                    "required": ["start_date", "end_date"]
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

    let pool_clone = pool.clone();
    let user_id_clone = user_id;
    let family_id_clone = family_id;
    let api_url = llm_config.api_url.clone();
    let api_key_clone = api_key.clone();
    let model_name = llm_config.model_name.clone();
    let messages_clone = messages.clone();

    let stream = async_stream::stream! {
        let mut full_response = String::new();
        let mut byte_stream = response.bytes_stream();
        let mut buffer = String::new();

        // Accumulate tool call chunks
        let mut tool_call_name = String::new();
        let mut tool_call_args = String::new();
        let mut has_tool_call = false;

        while let Some(chunk) = byte_stream.next().await {
            match chunk {
                Ok(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));

                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..pos].trim().to_string();
                        buffer = buffer[pos + 1..].to_string();

                        if line.is_empty() {
                            continue;
                        }

                        if line == "data: [DONE]" {
                            break;
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
                                    has_tool_call = true;
                                    for tc in tool_calls {
                                        if let Some(name) = tc["function"]["name"].as_str() {
                                            tool_call_name = name.to_string();
                                        }
                                        if let Some(args) = tc["function"]["arguments"].as_str() {
                                            tool_call_args.push_str(args);
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

        // Execute tool call if one was accumulated
        if has_tool_call && tool_call_name == "create_transaction" {
            tracing::debug!(args = %tool_call_args, "svc::chat_stream: executing create_transaction");

            match execute_create_transaction(&pool_clone, user_id_clone, family_id_clone, &tool_call_args).await {
                Ok(summary) => {
                    full_response.push_str(&summary);
                    let result_json = serde_json::json!({
                        "success": true,
                        "summary": summary,
                    });
                    yield Ok(Event::default().event("tool_result").data(
                        serde_json::to_string(&result_json).unwrap_or_default()
                    ));
                }
                Err(err_msg) => {
                    let error_text = format!("\n\n记账失败: {}", err_msg);
                    full_response.push_str(&error_text);
                    let result_json = serde_json::json!({
                        "success": false,
                        "error": err_msg,
                    });
                    yield Ok(Event::default().event("tool_result").data(
                        serde_json::to_string(&result_json).unwrap_or_default()
                    ));
                }
            }
        } else if has_tool_call && tool_call_name == "query_transactions" {
            tracing::debug!(args = %tool_call_args, "svc::chat_stream: executing query_transactions");

            match execute_query_transactions(&pool_clone, family_id_clone, &tool_call_args).await {
                Ok(query_result_text) => {
                    // Build second LLM request with tool result
                    let mut second_messages = messages_clone.clone();
                    second_messages.push(serde_json::json!({
                        "role": "assistant",
                        "tool_calls": [{
                            "id": "call_query",
                            "type": "function",
                            "function": {
                                "name": "query_transactions",
                                "arguments": tool_call_args
                            }
                        }]
                    }));
                    second_messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": "call_query",
                        "content": query_result_text
                    }));

                    let second_body = serde_json::json!({
                        "model": model_name,
                        "messages": second_messages,
                        "stream": true,
                    });

                    let client2 = reqwest::Client::new();
                    let resp2 = client2
                        .post(&api_url)
                        .header("Authorization", format!("Bearer {}", api_key_clone))
                        .header("Content-Type", "application/json")
                        .json(&second_body)
                        .send()
                        .await;

                    match resp2 {
                        Ok(r) if r.status().is_success() => {
                            let mut stream2 = r.bytes_stream();
                            let mut buf2 = String::new();

                            while let Some(chunk2) = stream2.next().await {
                                if let Ok(bytes2) = chunk2 {
                                    buf2.push_str(&String::from_utf8_lossy(&bytes2));

                                    while let Some(pos2) = buf2.find('\n') {
                                        let line2 = buf2[..pos2].trim().to_string();
                                        buf2 = buf2[pos2 + 1..].to_string();

                                        if line2.is_empty() || line2 == "data: [DONE]" {
                                            continue;
                                        }

                                        if let Some(data2) = line2.strip_prefix("data: ") {
                                            if let Ok(p2) = serde_json::from_str::<serde_json::Value>(data2) {
                                                if let Some(c) = p2["choices"][0]["delta"]["content"].as_str() {
                                                    if !c.is_empty() {
                                                        full_response.push_str(c);
                                                        yield Ok(Event::default().data(c));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Ok(r) => {
                            let err = format!("查询分析失败: LLM 返回 {}", r.status());
                            full_response.push_str(&err);
                            yield Ok(Event::default().data(&err));
                        }
                        Err(e) => {
                            let err = format!("查询分析失败: {}", e);
                            full_response.push_str(&err);
                            yield Ok(Event::default().data(&err));
                        }
                    }
                }
                Err(err_msg) => {
                    let error_text = format!("查询失败: {}", err_msg);
                    full_response.push_str(&error_text);
                    yield Ok(Event::default().data(&error_text));
                }
            }
        }

        yield Ok(Event::default().data("[DONE]"));

        // Save assistant response
        if !full_response.is_empty() {
            let _ = sqlx::query(
                "INSERT INTO chat_messages (id, user_id, family_id, role, content, created_at)
                 Values ($1, $1, $2, 'assistant', $3, $4)",
            )
            .bind(Uuid::new_v4())
            .bind(family_id_clone)
            .bind(&full_response)
            .bind(Utc::now())
            .execute(&pool_clone)
            .await;
        }
    };

    Ok(stream)
}

async fn execute_create_transaction(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    args_json: &str,
) -> Result<String, String> {
    let args: serde_json::Value =
        serde_json::from_str(args_json).map_err(|e| format!("解析参数失败: {}", e))?;

    let txn_type = args["type"]
        .as_str()
        .ok_or("缺少交易类型")?
        .to_string();
    let amount = args["amount"]
        .as_f64()
        .ok_or("缺少金额")?;
    let category_name = args["category_name"]
        .as_str()
        .ok_or("缺少分类名称")?;
    let date_str = args["date"]
        .as_str()
        .ok_or("缺少日期")?;
    let subcategory_name = args["subcategory_name"].as_str();
    let currency = args["currency"].as_str().unwrap_or("CNY");
    let time_str = args["time"].as_str();
    let note = args["note"].as_str();
    let members: Option<Vec<String>> = args["members"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

    // Resolve category
    let category = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE name = $1 AND (user_id IS NULL OR family_id = $2) LIMIT 1",
    )
    .bind(category_name)
    .bind(family_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("查询分类失败: {}", e))?
    .ok_or_else(|| format!("找不到分类「{}」", category_name))?;

    // Resolve subcategory
    let subcategory_id = if let Some(sub_name) = subcategory_name {
        let sub = sqlx::query_as::<_, Subcategory>(
            "SELECT * FROM subcategories WHERE name = $1 AND category_id = $2 LIMIT 1",
        )
        .bind(sub_name)
        .bind(category.id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("查询子分类失败: {}", e))?;
        sub.map(|s| s.id)
    } else {
        None
    };

    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .map_err(|_| format!("日期格式错误: {}", date_str))?;

    let time = if let Some(t) = time_str {
        NaiveTime::parse_from_str(t, "%H:%M:%S")
            .or_else(|_| NaiveTime::parse_from_str(t, "%H:%M"))
            .unwrap_or_else(|_| Local::now().time())
    } else {
        Local::now().time()
    };

    let amount_decimal = Decimal::from_str(&format!("{:.2}", amount))
        .map_err(|_| format!("金额格式错误: {}", amount))?;

    let req = CreateTransactionRequest {
        category_id: category.id,
        subcategory_id,
        r#type: txn_type.clone(),
        amount: amount_decimal,
        currency: currency.to_string(),
        date,
        time,
        location: None,
        note: note.map(String::from),
        members,
    };

    let txn = transaction::create_transaction(pool, user_id, family_id, req)
        .await
        .map_err(|e| format!("创建交易失败: {}", e))?;

    let type_label = if txn_type == "income" { "收入" } else { "支出" };
    let sub_label = if let Some(sub_name) = subcategory_name {
        format!(" > {}", sub_name)
    } else {
        String::new()
    };
    let member_label = if let Some(m) = args["members"].as_array() {
        if !m.is_empty() {
            let names: Vec<&str> = m.iter().filter_map(|v| v.as_str()).collect();
            format!("\n成员: {}", names.join("、"))
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    let note_label = note.map(|n| format!("\n备注: {}", n)).unwrap_or_default();

    let summary = format!(
        "\n\n✅ 记账成功！\n{type_label} {amount:.2} {currency}\n分类: {category}{sub}\n日期: {date} {time}{members}{note}",
        type_label = type_label,
        amount = amount,
        currency = currency,
        category = category_name,
        sub = sub_label,
        date = date.format("%Y-%m-%d"),
        time = time.format("%H:%M"),
        members = member_label,
        note = note_label,
    );

    tracing::info!(txn_id = %txn.id, "svc::chat_stream: transaction created via AI");
    Ok(summary)
}

async fn execute_query_transactions(
    pool: &PgPool,
    family_id: Uuid,
    args_json: &str,
) -> Result<String, String> {
    let args: serde_json::Value =
        serde_json::from_str(args_json).map_err(|e| format!("解析参数失败: {}", e))?;

    let start_date_str = args["start_date"]
        .as_str()
        .ok_or("缺少起始日期")?;
    let end_date_str = args["end_date"]
        .as_str()
        .ok_or("缺少结束日期")?;

    let start_date = NaiveDate::parse_from_str(start_date_str, "%Y-%m-%d")
        .map_err(|_| format!("起始日期格式错误: {}", start_date_str))?;
    let end_date = NaiveDate::parse_from_str(end_date_str, "%Y-%m-%d")
        .map_err(|_| format!("结束日期格式错误: {}", end_date_str))?;

    let txn_type = args["type"].as_str().map(String::from);
    let category_name = args["category_name"].as_str();
    let member_name = args["member_name"].as_str().map(String::from);

    // Resolve category_name → category_id
    let category_id = if let Some(cat_name) = category_name {
        let cat = sqlx::query_as::<_, Category>(
            "SELECT * FROM categories WHERE name = $1 AND (user_id IS NULL OR family_id = $2) LIMIT 1",
        )
        .bind(cat_name)
        .bind(family_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("查询分类失败: {}", e))?;
        cat.map(|c| c.id)
    } else {
        None
    };

    let filter = crate::models::TransactionFilter {
        start_date: Some(start_date),
        end_date: Some(end_date),
        category_id,
        subcategory_id: None,
        r#type: txn_type,
        search: None,
        member_name,
        min_amount: None,
        max_amount: None,
        page: Some(1),
        per_page: Some(100),
    };

    let result = transaction::list_transactions(pool, family_id, filter)
        .await
        .map_err(|e| format!("查询交易失败: {}", e))?;

    // Also fetch category names for display
    let cat_map: std::collections::HashMap<Uuid, String> = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE user_id IS NULL OR family_id = $1",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询分类失败: {}", e))?
    .into_iter()
    .map(|c| (c.id, c.name))
    .collect();

    // Format results
    let mut total_income = Decimal::ZERO;
    let mut total_expense = Decimal::ZERO;
    let mut lines = Vec::new();

    for txn in &result.data {
        if txn.r#type == "income" {
            total_income += txn.amount;
        } else {
            total_expense += txn.amount;
        }
        let cat_name = cat_map.get(&txn.category_id).map(|s| s.as_str()).unwrap_or("未知");
        let type_mark = if txn.r#type == "income" { "+" } else { "-" };
        let note_part = txn.note.as_deref().unwrap_or("");
        lines.push(format!(
            "{} | {}{} {} | {} | {}",
            txn.date.format("%Y-%m-%d"),
            type_mark,
            txn.amount,
            txn.currency,
            cat_name,
            note_part,
        ));
    }

    let summary = format!(
        "查询结果（{} 至 {}）:\n总计 {} 条记录\n总收入: {} CNY\n总支出: {} CNY\n净额: {} CNY\n\n明细:\n{}",
        start_date.format("%Y-%m-%d"),
        end_date.format("%Y-%m-%d"),
        result.total,
        total_income,
        total_expense,
        total_income - total_expense,
        if lines.is_empty() { "无记录".to_string() } else { lines.join("\n") },
    );

    Ok(summary)
}
