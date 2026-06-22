use axum::response::sse::Event;
use chrono::{Datelike, Local, NaiveDate, NaiveTime, Utc};
use futures::StreamExt;
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::convert::Infallible;
use std::str::FromStr;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    AiReport, AiReportSummary, Category, ChatMessage, CreateSocialGiftRequest,
    CreateTransactionRequest, LlmConfig, LlmConfigRequest, Member, OcrAvailability, OcrResult,
    SaveReportRequest, SocialGiftFilter, Subcategory,
};
use crate::services::{social_gift, stats, transaction};

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
    user_id: Uuid,
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
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
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
        "max_tokens": 512,
        "stream": false,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
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
                "请求超时（60秒），请检查 API 地址是否可访问".to_string()
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

    let message = &body["choices"][0]["message"];
    let reply = message["content"].as_str().unwrap_or("").trim().to_string();

    if !reply.is_empty() {
        return Ok(reply);
    }

    // Reasoning models (DeepSeek R1, Gemma thinking, etc.) may put their output
    // in `reasoning_content` and leave `content` empty. If reasoning is present,
    // the model is reachable and working — treat it as a successful test.
    let reasoning = message["reasoning_content"].as_str().unwrap_or("").trim();
    if !reasoning.is_empty() {
        return Ok("连接成功（推理模型）".to_string());
    }

    Err("模型返回了空响应，请检查模型名称是否正确".to_string())
}

// ── Chat with streaming ──────────────────────────────────────────────

pub async fn get_chat_history(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<Vec<ChatMessage>, AppError> {
    tracing::debug!(family_id = %family_id, "svc::get_chat_history: querying");
    // Only return user-facing prose. Internal tool-call rows (role='tool' and
    // assistant turns carrying only tool_calls) are persisted for AI context but
    // must not surface in the chat UI.
    let messages = sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM chat_messages
         WHERE family_id = $1
           AND role IN ('user', 'assistant')
           AND tool_calls IS NULL
           AND content <> ''
         ORDER BY created_at ASC",
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
         VALUES ($1, $2, $3, 'user', $4, $5)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
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
        "你是 PenyCounts 家庭记账应用的 AI 助手。你可以帮用户记账、查账、删账、改账、查看统计、记录人情往来。\n\n\
         当前时间: {now}\n\n\
         ## 可用分类（含子分类）:\n{category_list}\n\
         ## 已有家庭成员:\n{member_list}\n\n\
         ## 你的能力:\n\
         1. **记账**: 用户描述收支时，调用 create_transaction\n\
         2. **查账**: 用户查询账单时，调用 query_transactions\n\
         3. **删账**: 用户要删除记录时，先用 query_transactions 找到对应记录，再调用 delete_transaction\n\
         4. **改账**: 用户要修改记录时，先查找，再调用 update_transaction\n\
         5. **统计**: 用户问月度趋势、分类占比、成员消费等，调用 get_statistics\n\
         6. **人情往来**: 用户记录红包、礼金等，调用 create_social_gift\n\
         7. **查询人情**: 用户查询人情来往记录，调用 query_social_gifts\n\n\
         ## 记账规则:\n\
         - **批量记账**: 用户一次描述多笔时（如「打车20，买菜50，工资到账8000」），把每一笔拆开，为每一笔分别调用一次 create_transaction（可在同一轮发起多个调用），全部记完后用列表汇总确认\n\
         - **type**: income 或 expense，根据语义判断\n\
         - **category_name**: 从可用分类中选择最匹配的\n\
         - **subcategory_name**: 只能从上面「可用分类（含子分类）」中、所选 category_name 名下列出的子分类里挑选，不要填其它一级分类下的子分类\n\
         - **date**: 格式 YYYY-MM-DD。「今天」= {today}，「昨天」= 前一天\n\
         - 如果缺少 type 或 amount，追问用户\n\
         - 如果缺少 date，默认今天 ({today})\n\n\
         ## 人情往来规则:\n\
         - type 为 given（送出）或 received（收到）\n\
         - occasion 为事由（如 结婚、生日、满月 等）\n\
         - 「送张三结婚红包」→ type=given, person_name=张三, occasion=结婚\n\
         - 「收到李四的生日礼金」→ type=received, person_name=李四, occasion=生日\n\n\
         ## 行为准则:\n\
         1. 不要在回复中输出 JSON，直接调用工具；记账/改账/删账/记人情必须真正调用对应工具完成。绝不要自己编造或复述「✅ 记账成功」「✅ 人情记录成功」「✅ 已更新」「✅ 已删除」之类的结果文本——这些只由系统在工具执行成功后返回，你的文字回复只做简短的中文确认（如「已为您记录…」）\n\
         2. 如果用户只是闲聊或问问题，正常回答\n\
         3. 你可以在一次对话中连续调用多个工具（如先查后删）\n\
         4. 删除和修改操作前，如果不确定是哪条记录，先查询确认\n\
         5. 查询时间范围：「最近一个月」从 {one_month_ago} 到 {today}，「本月」从本月1号到今天\n\
         6. 成功操作后用简洁格式确认结果\n\
         7. **严格遵守用户指定的时间范围**：用户问「4月份」就只查 2026-04-01 至 2026-04-30，绝不要自行扩大到全年或其它区间。即使该范围数据较少或为空，也只基于该范围作答（没有就如实说「该时间段没有记录」）\n\
         8. 问「最大/最贵/最高的 N 笔」时，调用 query_transactions 并设置 sort_by=amount_desc、limit=N，直接用返回的前 N 条作答，不要再调别的工具\n\
         9. **一旦某次工具结果已经能回答用户的问题，就立即用中文文字作答，不要用不同/更大的范围重复查询**\n\
         10. **回复排版用规范 Markdown**：列举多条时务必每条独占一行；有序列表写成「1. 内容」（数字、点、空格，再接内容），各条之间用换行分隔，绝不要把 1.2.3. 挤在同一行；金额、要点可用 **加粗** 突出",
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

    // Rebuild a faithful OpenAI-format history including tool calls and tool
    // results. A text-only history (assistant prose with no tool context) taught
    // weak models that "recording" just means replying with a confirmation
    // sentence — so they stopped calling the tools. Replaying the real chain
    // (user → assistant[tool_calls] → tool → assistant) keeps them on track.
    let mut history_msgs: Vec<serde_json::Value> = Vec::new();
    for msg in history.into_iter().rev() {
        match msg.role.as_str() {
            "tool" => {
                history_msgs.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": msg.tool_call_id.unwrap_or_default(),
                    "content": msg.content,
                }));
            }
            "assistant" => {
                // Strip any legacy "✅ 记账成功！…" echo blocks from older rows.
                let content = strip_tool_echoes(&msg.content);
                let tool_calls = msg
                    .tool_calls
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());

                let mut m = serde_json::json!({ "role": "assistant" });
                if !content.is_empty() {
                    m["content"] = serde_json::Value::String(content.clone());
                }
                match tool_calls {
                    Some(tc) => m["tool_calls"] = tc,
                    None if content.is_empty() => continue, // nothing useful
                    None => {}
                }
                history_msgs.push(m);
            }
            _ => {
                if msg.content.trim().is_empty() {
                    continue;
                }
                history_msgs.push(serde_json::json!({
                    "role": "user",
                    "content": msg.content,
                }));
            }
        }
    }

    // The 20-message window may begin in the middle of a tool turn, leaving
    // leading `tool` messages whose parent assistant `tool_calls` fell outside
    // the window. The API rejects a tool message without a preceding tool call,
    // so drop those orphans.
    while matches!(
        history_msgs.first().and_then(|m| m.get("role")).and_then(|r| r.as_str()),
        Some("tool")
    ) {
        history_msgs.remove(0);
    }

    messages.extend(history_msgs);

    let tools = serde_json::json!([
        {
            "type": "function",
            "function": {
                "name": "create_transaction",
                "description": "创建一条新的收支记录。当用户描述了一笔明确的收入或支出时调用此工具。如果用户一次性描述了多笔（如「打车20，午饭35，买菜50」），请为每一笔分别调用一次本工具（可在同一轮一次性发起多个调用）。",
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
                "description": "查询用户的交易记录。用于回答用户关于消费统计、支出分析等问题。返回指定时间范围内的交易明细。当用户问「最大/最贵/最高的N笔」时，务必设置 sort_by=amount_desc 并用 limit 限定条数。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "start_date": {
                            "type": "string",
                            "format": "date",
                            "description": "查询起始日期（含），格式 YYYY-MM-DD。严格按用户指定的范围，不要自行扩大。"
                        },
                        "end_date": {
                            "type": "string",
                            "format": "date",
                            "description": "查询结束日期（含），格式 YYYY-MM-DD。严格按用户指定的范围，不要自行扩大。"
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
                        },
                        "sort_by": {
                            "type": "string",
                            "enum": ["date_desc", "amount_desc"],
                            "description": "排序方式（可选）: date_desc=按日期倒序(默认), amount_desc=按金额从大到小。问「最大/最贵的N笔」时用 amount_desc。"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "最多返回多少条记录（可选，默认100，最大200）。问「最大的3笔」时设为3。"
                        }
                    },
                    "required": ["start_date", "end_date"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_transaction",
                "description": "删除一条交易记录。需要提供交易ID。如果不确定ID，请先用 query_transactions 查询。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "transaction_id": {
                            "type": "string",
                            "description": "要删除的交易记录ID（UUID格式）"
                        }
                    },
                    "required": ["transaction_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_transaction",
                "description": "修改一条已有的交易记录。需要提供交易ID和要修改的字段。如果不确定ID，请先用 query_transactions 查询。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "transaction_id": {
                            "type": "string",
                            "description": "要修改的交易记录ID（UUID格式）"
                        },
                        "type": {
                            "type": "string",
                            "enum": ["income", "expense"],
                            "description": "修改交易类型"
                        },
                        "amount": {
                            "type": "number",
                            "description": "修改金额"
                        },
                        "category_name": {
                            "type": "string",
                            "description": "修改一级分类名称"
                        },
                        "subcategory_name": {
                            "type": "string",
                            "description": "修改二级分类名称"
                        },
                        "date": {
                            "type": "string",
                            "format": "date",
                            "description": "修改日期，格式 YYYY-MM-DD"
                        },
                        "time": {
                            "type": "string",
                            "description": "修改时间，格式 HH:MM:SS"
                        },
                        "note": {
                            "type": "string",
                            "description": "修改备注"
                        }
                    },
                    "required": ["transaction_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_statistics",
                "description": "获取统计分析数据。可查询月度收支趋势、分类支出占比、成员消费分析。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "stat_type": {
                            "type": "string",
                            "enum": ["monthly_trend", "category_breakdown", "member_breakdown"],
                            "description": "统计类型: monthly_trend=月度收支趋势, category_breakdown=分类支出占比, member_breakdown=成员消费分析"
                        },
                        "year": {
                            "type": "integer",
                            "description": "查询年份"
                        },
                        "month": {
                            "type": "integer",
                            "description": "查询月份（可选，1-12）"
                        },
                        "type": {
                            "type": "string",
                            "enum": ["income", "expense"],
                            "description": "筛选收入或支出（仅 category_breakdown 和 member_breakdown 有效）"
                        }
                    },
                    "required": ["stat_type", "year"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "create_social_gift",
                "description": "记录一笔人情往来（红包、礼金、随礼等）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["given", "received"],
                            "description": "类型: given=送出, received=收到"
                        },
                        "person_name": {
                            "type": "string",
                            "description": "对方姓名"
                        },
                        "relation": {
                            "type": "string",
                            "description": "关系（如 朋友、亲戚、同事，可选）"
                        },
                        "occasion": {
                            "type": "string",
                            "description": "事由（如 结婚、生日、满月、乔迁）"
                        },
                        "amount": {
                            "type": "number",
                            "description": "金额"
                        },
                        "date": {
                            "type": "string",
                            "format": "date",
                            "description": "日期，格式 YYYY-MM-DD"
                        },
                        "note": {
                            "type": "string",
                            "description": "备注（可选）"
                        }
                    },
                    "required": ["type", "person_name", "occasion", "amount", "date"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "query_social_gifts",
                "description": "查询人情往来记录。可按时间、人名、类型筛选。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "start_date": {
                            "type": "string",
                            "format": "date",
                            "description": "查询起始日期，格式 YYYY-MM-DD"
                        },
                        "end_date": {
                            "type": "string",
                            "format": "date",
                            "description": "查询结束日期，格式 YYYY-MM-DD"
                        },
                        "person_name": {
                            "type": "string",
                            "description": "筛选对方姓名（可选）"
                        },
                        "type": {
                            "type": "string",
                            "enum": ["given", "received"],
                            "description": "筛选类型（可选）"
                        }
                    },
                    "required": ["start_date", "end_date"]
                }
            }
        }
    ]);

    let api_key = llm_config.api_key.unwrap_or_default();
    let api_url = llm_config.api_url.clone();
    let model_name = llm_config.model_name.clone();
    let pool_clone = pool.clone();

    const MAX_ITERATIONS: usize = 10;

    let stream = async_stream::stream! {
        let client = reqwest::Client::new();
        // Messages to persist for this turn, in order, so the next request can
        // replay the full tool-call chain: (role, content, tool_calls, tool_call_id).
        let mut persist: Vec<(&'static str, String, Option<String>, Option<String>)> = Vec::new();

        // Loop guard: weak models often re-issue the *same* tool call repeatedly
        // and never converge. We cache executed signatures so duplicates don't
        // re-hit the DB, and once a duplicate is seen we force the model to
        // answer in plain text (tool_choice = none) on the next turn.
        let mut executed_signatures: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut force_final = false;

        for iteration in 0..MAX_ITERATIONS {
            tracing::debug!(iteration, force_final, "agent loop: starting iteration");

            let mut request_body = serde_json::json!({
                "model": model_name,
                "messages": messages,
                "stream": true,
                "tools": tools,
            });
            if force_final {
                // Stop offering tools so the model produces a textual answer
                // from the results it already gathered.
                request_body["tool_choice"] = serde_json::json!("none");
            }

            let response = match client
                .post(&api_url)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&request_body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!(error = %e, "agent loop: LLM request failed");
                    yield Ok(Event::default().event("error").data(format!("LLM 请求失败: {}", e)));
                    break;
                }
            };

            if !response.status().is_success() {
                let body = response.text().await.unwrap_or_default();
                tracing::error!(body = %body, "agent loop: LLM API error");
                yield Ok(Event::default().event("error").data(format!("LLM API 错误: {}", body)));
                break;
            }

            // Stream one LLM turn, accumulate content + tool calls
            let mut turn_content = String::new();
            let mut tool_calls: Vec<(String, String, String)> = Vec::new(); // (id, name, args)
            // Temp accumulators for streaming tool call chunks (keyed by index)
            let mut tc_indices: std::collections::HashMap<usize, (String, String, String)> = std::collections::HashMap::new();

            let mut byte_stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut thinking_phase = false;

            while let Some(chunk) = byte_stream.next().await {
                match chunk {
                    Ok(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));

                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].trim().to_string();
                            buffer = buffer[pos + 1..].to_string();

                            if line.is_empty() { continue; }
                            if line == "data: [DONE]" { break; }

                            if let Some(data) = line.strip_prefix("data: ") {
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                                    let delta = &parsed["choices"][0]["delta"];
                                    let reasoning = delta["reasoning_content"].as_str().unwrap_or("");
                                    let content_text = delta["content"].as_str().unwrap_or("");

                                    if !reasoning.is_empty() {
                                        thinking_phase = true;
                                    }

                                    if thinking_phase && reasoning.is_empty() && !content_text.is_empty() {
                                        thinking_phase = false;
                                    }

                                    if !content_text.is_empty() && !thinking_phase {
                                        turn_content.push_str(content_text);
                                        yield Ok(Event::default().data(content_text));
                                    }

                                    // Accumulate tool calls (may arrive across multiple chunks)
                                    if let Some(tcs) = parsed["choices"][0]["delta"]["tool_calls"].as_array() {
                                        for tc in tcs {
                                            let idx = tc["index"].as_u64().unwrap_or(0) as usize;
                                            let entry = tc_indices.entry(idx).or_insert_with(|| {
                                                let id = tc["id"].as_str().unwrap_or("").to_string();
                                                (id, String::new(), String::new())
                                            });
                                            if let Some(id) = tc["id"].as_str() {
                                                if !id.is_empty() { entry.0 = id.to_string(); }
                                            }
                                            if let Some(name) = tc["function"]["name"].as_str() {
                                                entry.1.push_str(name);
                                            }
                                            if let Some(args) = tc["function"]["arguments"].as_str() {
                                                entry.2.push_str(args);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "agent loop: stream error");
                        yield Ok(Event::default().event("error").data(e.to_string()));
                        break;
                    }
                }
            }

            // Collect accumulated tool calls sorted by index
            let mut sorted_indices: Vec<usize> = tc_indices.keys().copied().collect();
            sorted_indices.sort();
            for idx in sorted_indices {
                if let Some(tc) = tc_indices.remove(&idx) {
                    tool_calls.push(tc);
                }
            }

            // No tool calls → agent is done; this turn's prose is the final answer.
            if tool_calls.is_empty() {
                tracing::debug!(iteration, "agent loop: no tool calls, done");
                if !turn_content.trim().is_empty() {
                    persist.push(("assistant", turn_content.clone(), None, None));
                }
                break;
            }

            // The model ignored tool_choice=none and is still looping on tools
            // it already ran. Stop here to avoid burning iterations / hanging.
            if force_final
                && tool_calls
                    .iter()
                    .all(|(_, name, args)| executed_signatures.contains(&format!("{}|{}", name, args)))
            {
                tracing::warn!(iteration, "agent loop: model stuck repeating tool calls, breaking");
                break;
            }

            tracing::debug!(iteration, count = tool_calls.len(), "agent loop: executing tool calls");

            // Build assistant message with tool_calls for message history
            let tc_json: Vec<serde_json::Value> = tool_calls.iter().map(|(id, name, args)| {
                serde_json::json!({
                    "id": id,
                    "type": "function",
                    "function": { "name": name, "arguments": args }
                })
            }).collect();

            let tc_array = serde_json::Value::Array(tc_json);
            let tc_string = serde_json::to_string(&tc_array).ok();

            let mut assistant_msg = serde_json::json!({ "role": "assistant" });
            if !turn_content.is_empty() {
                assistant_msg["content"] = serde_json::Value::String(turn_content.clone());
            }
            assistant_msg["tool_calls"] = tc_array;
            messages.push(assistant_msg);
            persist.push(("assistant", turn_content.clone(), tc_string, None));

            // Execute each tool call and append results
            for (tc_id, tc_name, tc_args) in &tool_calls {
                // Only de-duplicate *read-only* tools. Write operations
                // (create/update/delete/social_gift) must always run — a user
                // may legitimately batch two identical entries, and dedup would
                // silently drop the second one.
                let is_read_only = matches!(
                    tc_name.as_str(),
                    "query_transactions" | "get_statistics" | "query_social_gifts"
                );

                // Duplicate query: don't re-query the DB, just nudge the model to
                // answer from what it already has. Forces convergence next turn.
                if is_read_only && !executed_signatures.insert(format!("{}|{}", tc_name, tc_args)) {
                    tracing::warn!(tool = %tc_name, args = %tc_args, "agent loop: duplicate tool call, skipping execution");
                    force_final = true;
                    let dup_note = "（已用相同条件查询过，结果见上文。请不要再调用工具，直接根据上面的数据用中文回答用户的问题。）";
                    messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": dup_note,
                    }));
                    // Persist so the assistant tool_calls row above keeps a
                    // matching tool response (every tool_call needs one).
                    persist.push(("tool", dup_note.to_string(), None, Some(tc_id.clone())));
                    continue;
                }

                tracing::debug!(tool = %tc_name, args = %tc_args, "agent loop: executing tool");

                let (result_content, is_success) = match tc_name.as_str() {
                    "create_transaction" => {
                        match execute_create_transaction(&pool_clone, user_id, family_id, tc_args).await {
                            Ok(summary) => {
                                let result_json = serde_json::json!({ "success": true, "summary": summary });
                                yield Ok(Event::default().event("tool_result").data(
                                    serde_json::to_string(&result_json).unwrap_or_default()
                                ));
                                (summary, true)
                            }
                            Err(err_msg) => {
                                let result_json = serde_json::json!({ "success": false, "error": err_msg });
                                yield Ok(Event::default().event("tool_result").data(
                                    serde_json::to_string(&result_json).unwrap_or_default()
                                ));
                                (format!("Error: {}", err_msg), false)
                            }
                        }
                    }
                    "query_transactions" => {
                        match execute_query_transactions(&pool_clone, family_id, tc_args).await {
                            Ok(result) => (result, true),
                            Err(err_msg) => (format!("Error: {}", err_msg), false),
                        }
                    }
                    "delete_transaction" => {
                        match execute_delete_transaction(&pool_clone, family_id, tc_args).await {
                            Ok(summary) => {
                                let result_json = serde_json::json!({ "success": true, "summary": summary });
                                yield Ok(Event::default().event("tool_result").data(
                                    serde_json::to_string(&result_json).unwrap_or_default()
                                ));
                                (summary, true)
                            }
                            Err(err_msg) => {
                                let result_json = serde_json::json!({ "success": false, "error": err_msg });
                                yield Ok(Event::default().event("tool_result").data(
                                    serde_json::to_string(&result_json).unwrap_or_default()
                                ));
                                (format!("Error: {}", err_msg), false)
                            }
                        }
                    }
                    "update_transaction" => {
                        match execute_update_transaction(&pool_clone, user_id, family_id, tc_args).await {
                            Ok(summary) => {
                                let result_json = serde_json::json!({ "success": true, "summary": summary });
                                yield Ok(Event::default().event("tool_result").data(
                                    serde_json::to_string(&result_json).unwrap_or_default()
                                ));
                                (summary, true)
                            }
                            Err(err_msg) => {
                                let result_json = serde_json::json!({ "success": false, "error": err_msg });
                                yield Ok(Event::default().event("tool_result").data(
                                    serde_json::to_string(&result_json).unwrap_or_default()
                                ));
                                (format!("Error: {}", err_msg), false)
                            }
                        }
                    }
                    "get_statistics" => {
                        match execute_get_statistics(&pool_clone, family_id, tc_args).await {
                            Ok(result) => (result, true),
                            Err(err_msg) => (format!("Error: {}", err_msg), false),
                        }
                    }
                    "create_social_gift" => {
                        match execute_create_social_gift(&pool_clone, user_id, family_id, tc_args).await {
                            Ok(summary) => {
                                let result_json = serde_json::json!({ "success": true, "summary": summary });
                                yield Ok(Event::default().event("tool_result").data(
                                    serde_json::to_string(&result_json).unwrap_or_default()
                                ));
                                (summary, true)
                            }
                            Err(err_msg) => {
                                let result_json = serde_json::json!({ "success": false, "error": err_msg });
                                yield Ok(Event::default().event("tool_result").data(
                                    serde_json::to_string(&result_json).unwrap_or_default()
                                ));
                                (format!("Error: {}", err_msg), false)
                            }
                        }
                    }
                    "query_social_gifts" => {
                        match execute_query_social_gifts(&pool_clone, family_id, tc_args).await {
                            Ok(result) => (result, true),
                            Err(err_msg) => (format!("Error: {}", err_msg), false),
                        }
                    }
                    other => {
                        (format!("Unknown tool: {}", other), false)
                    }
                };

                let _ = is_success;
                persist.push(("tool", result_content.clone(), None, Some(tc_id.clone())));
                messages.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": result_content,
                }));
            }

            // Loop continues: next iteration sends updated messages back to LLM
        }

        yield Ok(Event::default().data("[DONE]"));

        // Persist the whole turn (assistant prose, tool calls, tool results) in
        // order, so the next request replays a faithful tool-call history. The
        // incremental millisecond offset guarantees a stable created_at ordering.
        let base = Utc::now();
        for (i, (role, content, tool_calls, tool_call_id)) in persist.into_iter().enumerate() {
            let _ = sqlx::query(
                "INSERT INTO chat_messages
                    (id, user_id, family_id, role, content, tool_calls, tool_call_id, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(Uuid::new_v4())
            .bind(user_id)
            .bind(family_id)
            .bind(role)
            .bind(content)
            .bind(tool_calls)
            .bind(tool_call_id)
            .bind(base + chrono::Duration::milliseconds(i as i64))
            .execute(&pool_clone)
            .await;
        }
    };

    Ok(stream)
}

/// Remove tool-result summary blocks (e.g. "✅ 记账成功！…") that older
/// assistant messages may still embed in their `content`. These echoes used to
/// be concatenated into the saved assistant message; replaying them as history
/// trained weak models to *fabricate* success text instead of calling the
/// tools. Stripping them keeps only the model's own prose in the LLM context.
fn strip_tool_echoes(content: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut in_echo = false;

    for line in content.lines() {
        let trimmed = line.trim();

        let is_marker = trimmed.starts_with("✅ 记账成功")
            || trimmed.starts_with("✅ 人情记录成功")
            || trimmed.starts_with("✅ 已成功删除")
            || trimmed.starts_with("✅ 已更新交易记录");
        if is_marker {
            in_echo = true;
            continue;
        }

        if in_echo {
            if trimmed.is_empty() {
                // Blank line ends the echo block.
                in_echo = false;
                continue;
            }
            let is_detail = trimmed.starts_with("支出 ")
                || trimmed.starts_with("收入 ")
                || trimmed.starts_with("分类:")
                || trimmed.starts_with("日期:")
                || trimmed.starts_with("时间:")
                || trimmed.starts_with("成员:")
                || trimmed.starts_with("备注:")
                || trimmed.starts_with("对方:")
                || trimmed.starts_with("事由:")
                || trimmed.starts_with("送出 ")
                || trimmed.starts_with("收到 ");
            if is_detail {
                continue;
            }
            // Not a detail line → the echo block is over; keep this line.
            in_echo = false;
        }

        out.push(line);
    }

    out.join("\n").trim().to_string()
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

    // Resolve category from the model-chosen name.
    let mut category = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE name = $1 AND (user_id IS NULL OR family_id = $2) LIMIT 1",
    )
    .bind(category_name)
    .bind(family_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("查询分类失败: {}", e))?
    .ok_or_else(|| format!("找不到分类「{}」", category_name))?;

    // Resolve subcategory. Weak models frequently pick the right subcategory but
    // the wrong parent (e.g. category=居家生活, subcategory=日常买菜 which really
    // belongs to 餐饮美食). If the subcategory isn't under the chosen category,
    // resolve it by name within this family; when it maps to exactly one
    // subcategory we adopt it AND correct the parent category — self-healing the
    // misclassification instead of silently dropping the subcategory.
    let subcategory_id = if let Some(sub_name) = subcategory_name {
        let exact = sqlx::query_as::<_, Subcategory>(
            "SELECT * FROM subcategories WHERE name = $1 AND category_id = $2 LIMIT 1",
        )
        .bind(sub_name)
        .bind(category.id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("查询子分类失败: {}", e))?;

        if let Some(s) = exact {
            Some(s.id)
        } else {
            // Look the subcategory up across the family's categories of the same
            // transaction type. Only auto-correct when it's unambiguous (a single
            // match) — names like 其他 exist under multiple parents.
            let candidates = sqlx::query_as::<_, Subcategory>(
                "SELECT s.* FROM subcategories s
                 JOIN categories c ON s.category_id = c.id
                 WHERE s.name = $1
                   AND (c.user_id IS NULL OR c.family_id = $2)
                   AND c.type = $3",
            )
            .bind(sub_name)
            .bind(family_id)
            .bind(&txn_type)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("查询子分类失败: {}", e))?;

            if candidates.len() == 1 {
                let s = &candidates[0];
                if s.category_id != category.id {
                    if let Some(real_parent) = sqlx::query_as::<_, Category>(
                        "SELECT * FROM categories WHERE id = $1 LIMIT 1",
                    )
                    .bind(s.category_id)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| format!("查询分类失败: {}", e))?
                    {
                        tracing::info!(
                            chosen = %category.name,
                            corrected = %real_parent.name,
                            subcategory = %sub_name,
                            "AI create_transaction: corrected parent category from subcategory",
                        );
                        category = real_parent;
                    }
                }
                Some(s.id)
            } else {
                // Ambiguous or unknown subcategory → keep the chosen category and
                // record without a subcategory.
                None
            }
        }
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
    // Only show the subcategory if it was actually resolved & saved.
    let sub_label = match (subcategory_id, subcategory_name) {
        (Some(_), Some(sub_name)) => format!(" > {}", sub_name),
        _ => String::new(),
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
        category = category.name,
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

    let sort_by = args["sort_by"].as_str().unwrap_or("date_desc");
    let limit_n: i64 = args["limit"].as_i64().unwrap_or(100).clamp(1, 200);

    // order_clause is chosen from a fixed allow-list (no user input) → injection-safe
    let order_clause = match sort_by {
        "amount_desc" => "ORDER BY t.amount DESC, t.date DESC, t.id",
        _ => "ORDER BY t.date DESC, t.time DESC, t.id",
    };

    // Aggregate over the FULL filtered range (independent of the row limit), so
    // totals stay correct even when we only return the top-N detail rows.
    let agg: (i64, Decimal, Decimal) = sqlx::query_as(
        "SELECT
            COUNT(*)::bigint,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0),
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)
         FROM transactions t
         WHERE t.family_id = $1
           AND t.date >= $2 AND t.date <= $3
           AND ($4::uuid IS NULL OR t.category_id = $4)
           AND ($5::text IS NULL OR t.type = $5)
           AND ($6::text IS NULL OR EXISTS (
                SELECT 1 FROM transaction_members tm
                WHERE tm.transaction_id = t.id AND tm.member_name = $6))",
    )
    .bind(family_id)
    .bind(start_date)
    .bind(end_date)
    .bind(category_id)
    .bind(&txn_type)
    .bind(&member_name)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("查询交易失败: {}", e))?;

    let total_count = agg.0;
    let total_income = agg.1;
    let total_expense = agg.2;

    let detail_sql = format!(
        "SELECT t.* FROM transactions t
         WHERE t.family_id = $1
           AND t.date >= $2 AND t.date <= $3
           AND ($4::uuid IS NULL OR t.category_id = $4)
           AND ($5::text IS NULL OR t.type = $5)
           AND ($6::text IS NULL OR EXISTS (
                SELECT 1 FROM transaction_members tm
                WHERE tm.transaction_id = t.id AND tm.member_name = $6))
         {order_clause}
         LIMIT $7"
    );

    let rows = sqlx::query_as::<_, crate::models::Transaction>(&detail_sql)
        .bind(family_id)
        .bind(start_date)
        .bind(end_date)
        .bind(category_id)
        .bind(&txn_type)
        .bind(&member_name)
        .bind(limit_n)
        .fetch_all(pool)
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

    let mut lines = Vec::new();
    for txn in &rows {
        let cat_name = cat_map.get(&txn.category_id).map(|s| s.as_str()).unwrap_or("未知");
        let type_mark = if txn.r#type == "income" { "+" } else { "-" };
        let note_part = txn.note.as_deref().unwrap_or("");
        lines.push(format!(
            "[{}] {} | {}{} {} | {} | {}",
            txn.id,
            txn.date.format("%Y-%m-%d"),
            type_mark,
            txn.amount,
            txn.currency,
            cat_name,
            note_part,
        ));
    }

    let sort_label = if sort_by == "amount_desc" { "按金额从大到小" } else { "按日期倒序" };
    let truncated_note = if total_count > rows.len() as i64 {
        format!(
            "\n\n（注意：该范围共 {} 条记录，以上仅{}返回前 {} 条。如需完整统计请改用 get_statistics，或缩小时间范围。）",
            total_count, sort_label, rows.len()
        )
    } else {
        String::new()
    };

    let summary = format!(
        "查询结果（{} 至 {}，排序：{}）:\n该范围共 {} 条记录，本次返回 {} 条\n区间总收入: {} CNY\n区间总支出: {} CNY\n净额: {} CNY\n\n明细:\n{}{}",
        start_date.format("%Y-%m-%d"),
        end_date.format("%Y-%m-%d"),
        sort_label,
        total_count,
        rows.len(),
        total_income,
        total_expense,
        total_income - total_expense,
        if lines.is_empty() { "无记录".to_string() } else { lines.join("\n") },
        truncated_note,
    );

    Ok(summary)
}

async fn execute_delete_transaction(
    pool: &PgPool,
    family_id: Uuid,
    args_json: &str,
) -> Result<String, String> {
    let args: serde_json::Value =
        serde_json::from_str(args_json).map_err(|e| format!("解析参数失败: {}", e))?;

    let txn_id_str = args["transaction_id"]
        .as_str()
        .ok_or("缺少 transaction_id")?;
    let txn_id = Uuid::parse_str(txn_id_str)
        .map_err(|_| format!("无效的交易ID: {}", txn_id_str))?;

    transaction::delete_transaction(pool, family_id, txn_id)
        .await
        .map_err(|e| format!("删除交易失败: {}", e))?;

    Ok(format!("\n\n✅ 已成功删除交易记录 ({})", &txn_id_str[..8]))
}

async fn execute_update_transaction(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    args_json: &str,
) -> Result<String, String> {
    let args: serde_json::Value =
        serde_json::from_str(args_json).map_err(|e| format!("解析参数失败: {}", e))?;

    let txn_id_str = args["transaction_id"]
        .as_str()
        .ok_or("缺少 transaction_id")?;
    let txn_id = Uuid::parse_str(txn_id_str)
        .map_err(|_| format!("无效的交易ID: {}", txn_id_str))?;

    let existing = transaction::get_transaction(pool, family_id, txn_id)
        .await
        .map_err(|e| format!("查询交易失败: {}", e))?;

    let txn_type = args["type"]
        .as_str()
        .map(String::from)
        .unwrap_or(existing.r#type.clone());

    let amount = args["amount"]
        .as_f64()
        .map(|v| Decimal::from_str(&format!("{:.2}", v)).unwrap_or(existing.amount))
        .unwrap_or(existing.amount);

    let date = args["date"]
        .as_str()
        .map(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d"))
        .transpose()
        .map_err(|_| "日期格式错误".to_string())?
        .unwrap_or(existing.date);

    let time = args["time"]
        .as_str()
        .map(|t| {
            NaiveTime::parse_from_str(t, "%H:%M:%S")
                .or_else(|_| NaiveTime::parse_from_str(t, "%H:%M"))
        })
        .transpose()
        .map_err(|_| "时间格式错误".to_string())?
        .unwrap_or(existing.time);

    let note = args["note"]
        .as_str()
        .map(String::from)
        .or(existing.note.clone());

    let category_id = if let Some(cat_name) = args["category_name"].as_str() {
        let cat = sqlx::query_as::<_, Category>(
            "SELECT * FROM categories WHERE name = $1 AND (user_id IS NULL OR family_id = $2) LIMIT 1",
        )
        .bind(cat_name)
        .bind(family_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("查询分类失败: {}", e))?
        .ok_or_else(|| format!("找不到分类「{}」", cat_name))?;
        cat.id
    } else {
        existing.category_id
    };

    let subcategory_id = if let Some(sub_name) = args["subcategory_name"].as_str() {
        let sub = sqlx::query_as::<_, Subcategory>(
            "SELECT * FROM subcategories WHERE name = $1 AND category_id = $2 LIMIT 1",
        )
        .bind(sub_name)
        .bind(category_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("查询子分类失败: {}", e))?;
        sub.map(|s| s.id)
    } else {
        existing.subcategory_id
    };

    let req = CreateTransactionRequest {
        category_id,
        subcategory_id,
        r#type: txn_type,
        amount,
        currency: existing.currency.clone(),
        date,
        time,
        location: existing.location.clone(),
        note,
        members: None,
    };

    let _ = transaction::update_transaction(pool, user_id, family_id, txn_id, req)
        .await
        .map_err(|e| format!("更新交易失败: {}", e))?;

    let mut changes = Vec::new();
    if args["amount"].is_number() { changes.push(format!("金额→{}", amount)); }
    if args["category_name"].is_string() { changes.push("分类已更新".to_string()); }
    if args["date"].is_string() { changes.push(format!("日期→{}", date)); }
    if args["note"].is_string() { changes.push("备注已更新".to_string()); }
    if args["type"].is_string() { changes.push(format!("类型→{}", args["type"].as_str().unwrap())); }

    let change_desc = if changes.is_empty() { "无变更".to_string() } else { changes.join("，") };
    Ok(format!("\n\n✅ 已更新交易记录：{}", change_desc))
}

async fn execute_get_statistics(
    pool: &PgPool,
    family_id: Uuid,
    args_json: &str,
) -> Result<String, String> {
    let args: serde_json::Value =
        serde_json::from_str(args_json).map_err(|e| format!("解析参数失败: {}", e))?;

    let stat_type = args["stat_type"]
        .as_str()
        .ok_or("缺少 stat_type")?;
    let year = args["year"]
        .as_i64()
        .ok_or("缺少 year")? as i32;
    let month = args["month"].as_i64().map(|m| m as u32);
    let txn_type = args["type"].as_str();

    match stat_type {
        "monthly_trend" => {
            let data = stats::monthly_trend(pool, family_id, year)
                .await
                .map_err(|e| format!("查询月度趋势失败: {}", e))?;

            if data.is_empty() {
                return Ok(format!("{}年暂无收支记录", year));
            }

            let mut lines = vec![format!("{}年月度收支趋势：", year)];
            for row in &data {
                lines.push(format!(
                    "{}月: 收入 {} / 支出 {} / 结余 {}",
                    row.month, row.income, row.expense,
                    row.income - row.expense,
                ));
            }
            let total_income: Decimal = data.iter().map(|r| r.income).sum();
            let total_expense: Decimal = data.iter().map(|r| r.expense).sum();
            lines.push(format!(
                "\n年度合计: 收入 {} / 支出 {} / 结余 {}",
                total_income, total_expense, total_income - total_expense,
            ));
            Ok(lines.join("\n"))
        }
        "category_breakdown" => {
            let data = stats::category_breakdown(pool, family_id, year, month, txn_type)
                .await
                .map_err(|e| format!("查询分类占比失败: {}", e))?;

            if data.is_empty() {
                let period = month.map(|m| format!("{}年{}月", year, m)).unwrap_or(format!("{}年", year));
                return Ok(format!("{}暂无{}数据", period, txn_type.unwrap_or("支出")));
            }

            let period = month.map(|m| format!("{}年{}月", year, m)).unwrap_or(format!("{}年", year));
            let type_label = if txn_type == Some("income") { "收入" } else { "支出" };
            let mut lines = vec![format!("{} {} 分类占比：", period, type_label)];
            for row in &data {
                lines.push(format!(
                    "{} {}: {} ({:.1}%)",
                    row.icon, row.category_name, row.total, row.percentage,
                ));
            }
            Ok(lines.join("\n"))
        }
        "member_breakdown" => {
            let data = stats::member_breakdown(pool, family_id, year, month, txn_type)
                .await
                .map_err(|e| format!("查询成员消费失败: {}", e))?;

            if data.is_empty() {
                let period = month.map(|m| format!("{}年{}月", year, m)).unwrap_or(format!("{}年", year));
                return Ok(format!("{}暂无成员消费数据", period));
            }

            let period = month.map(|m| format!("{}年{}月", year, m)).unwrap_or(format!("{}年", year));
            let mut lines = vec![format!("{} 成员消费分析：", period)];
            for row in &data {
                lines.push(format!("{}: {}", row.member_name, row.total));
            }
            Ok(lines.join("\n"))
        }
        _ => Err(format!("不支持的统计类型: {}", stat_type)),
    }
}

async fn execute_create_social_gift(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    args_json: &str,
) -> Result<String, String> {
    let args: serde_json::Value =
        serde_json::from_str(args_json).map_err(|e| format!("解析参数失败: {}", e))?;

    let gift_type = args["type"]
        .as_str()
        .ok_or("缺少 type（given/received）")?
        .to_string();
    let person_name = args["person_name"]
        .as_str()
        .ok_or("缺少 person_name")?
        .to_string();
    let occasion = args["occasion"]
        .as_str()
        .ok_or("缺少 occasion")?
        .to_string();
    let amount = args["amount"]
        .as_f64()
        .ok_or("缺少 amount")?;
    let date_str = args["date"]
        .as_str()
        .ok_or("缺少 date")?;
    let relation = args["relation"].as_str().map(String::from);
    let note = args["note"].as_str().map(String::from);

    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .map_err(|_| format!("日期格式错误: {}", date_str))?;
    let amount_decimal = Decimal::from_str(&format!("{:.2}", amount))
        .map_err(|_| format!("金额格式错误: {}", amount))?;

    let req = CreateSocialGiftRequest {
        r#type: gift_type.clone(),
        person_name: person_name.clone(),
        relation,
        occasion: occasion.clone(),
        amount: amount_decimal,
        currency: "CNY".to_string(),
        date,
        note,
    };

    social_gift::create_social_gift(pool, user_id, family_id, req)
        .await
        .map_err(|e| format!("记录人情往来失败: {}", e))?;

    let type_label = if gift_type == "given" { "送出" } else { "收到" };
    Ok(format!(
        "\n\n✅ 人情记录成功！\n{} {} {:.2} CNY\n对方: {}\n事由: {}\n日期: {}",
        type_label, person_name, amount, person_name, occasion, date_str,
    ))
}

async fn execute_query_social_gifts(
    pool: &PgPool,
    family_id: Uuid,
    args_json: &str,
) -> Result<String, String> {
    let args: serde_json::Value =
        serde_json::from_str(args_json).map_err(|e| format!("解析参数失败: {}", e))?;

    let start_date_str = args["start_date"]
        .as_str()
        .ok_or("缺少 start_date")?;
    let end_date_str = args["end_date"]
        .as_str()
        .ok_or("缺少 end_date")?;

    let start_date = NaiveDate::parse_from_str(start_date_str, "%Y-%m-%d")
        .map_err(|_| format!("起始日期格式错误: {}", start_date_str))?;
    let _end_date = NaiveDate::parse_from_str(end_date_str, "%Y-%m-%d")
        .map_err(|_| format!("结束日期格式错误: {}", end_date_str))?;

    let person_name = args["person_name"].as_str().map(String::from);
    let gift_type = args["type"].as_str().map(String::from);

    let filter = SocialGiftFilter {
        r#type: gift_type,
        person_name: person_name.clone(),
        year: Some(start_date.year()),
        page: Some(1),
        per_page: Some(100),
    };

    let result = social_gift::list_social_gifts(pool, family_id, filter)
        .await
        .map_err(|e| format!("查询人情往来失败: {}", e))?;

    let mut total_given = Decimal::ZERO;
    let mut total_received = Decimal::ZERO;
    let mut lines = Vec::new();

    for gift in &result.data {
        if gift.r#type == "given" {
            total_given += gift.amount;
        } else {
            total_received += gift.amount;
        }
        let type_mark = if gift.r#type == "given" { "送→" } else { "收←" };
        let note_part = gift.note.as_deref().unwrap_or("");
        lines.push(format!(
            "{} {} {} {:.2} {} | {} | {}",
            gift.date.format("%Y-%m-%d"),
            type_mark,
            gift.person_name,
            gift.amount,
            gift.currency,
            gift.occasion,
            note_part,
        ));
    }

    let person_label = person_name
        .map(|n| format!("（筛选: {}）", n))
        .unwrap_or_default();

    let summary = format!(
        "人情往来记录{}:\n总计 {} 条\n送出合计: {:.2} CNY\n收到合计: {:.2} CNY\n净额: {:.2} CNY\n\n明细:\n{}",
        person_label,
        result.total,
        total_given,
        total_received,
        total_received - total_given,
        if lines.is_empty() { "无记录".to_string() } else { lines.join("\n") },
    );

    Ok(summary)
}

// ── AI financial report (single-shot streaming, no tools) ────────────

/// Assemble a compact, factual data block the model narrates into a report.
async fn build_report_context(
    pool: &PgPool,
    family_id: Uuid,
    monthly: bool,
    year: i32,
    month: Option<u32>,
) -> Result<String, AppError> {
    let mut out = String::new();

    if monthly {
        let m = month.unwrap_or(1);
        let exp_cats =
            stats::category_breakdown(pool, family_id, year, Some(m), Some("expense")).await?;
        let inc_cats =
            stats::category_breakdown(pool, family_id, year, Some(m), Some("income")).await?;
        let members = stats::member_breakdown(pool, family_id, year, Some(m), None).await?;
        let daily = stats::daily_trend(pool, family_id, year, m).await?;

        let total_exp: Decimal = exp_cats.iter().map(|c| c.total).sum();
        let total_inc: Decimal = inc_cats.iter().map(|c| c.total).sum();
        let active_days = daily
            .iter()
            .filter(|d| !d.income.is_zero() || !d.expense.is_zero())
            .count();

        out.push_str(&format!(
            "时间范围: {year}年{m}月\n总收入: {total_inc} 元\n总支出: {total_exp} 元\n结余: {} 元\n有记账的天数: {active_days} 天\n\n",
            total_inc - total_exp
        ));

        out.push_str("支出分类 TOP（金额/占比）:\n");
        if exp_cats.is_empty() {
            out.push_str("（无支出）\n");
        } else {
            for c in exp_cats.iter().take(10) {
                out.push_str(&format!(
                    "- {} {}: {} 元 ({:.1}%)\n",
                    c.icon, c.category_name, c.total, c.percentage
                ));
            }
        }
        out.push('\n');

        out.push_str("收入来源:\n");
        if inc_cats.is_empty() {
            out.push_str("（无收入）\n");
        } else {
            for c in inc_cats.iter().take(8) {
                out.push_str(&format!("- {} {}: {} 元\n", c.icon, c.category_name, c.total));
            }
        }
        out.push('\n');

        out.push_str("成员分摊:\n");
        if members.is_empty() {
            out.push_str("（无成员数据）\n");
        } else {
            for mb in members.iter().take(10) {
                out.push_str(&format!("- {}: {} 元\n", mb.member_name, mb.total));
            }
        }
    } else {
        let trend = stats::monthly_trend(pool, family_id, year).await?;
        let exp_cats =
            stats::category_breakdown(pool, family_id, year, None, Some("expense")).await?;
        let inc_cats =
            stats::category_breakdown(pool, family_id, year, None, Some("income")).await?;
        let members = stats::member_breakdown(pool, family_id, year, None, None).await?;
        let social = stats::social_summary(pool, family_id, year).await?;

        let total_exp: Decimal = exp_cats.iter().map(|c| c.total).sum();
        let total_inc: Decimal = inc_cats.iter().map(|c| c.total).sum();

        out.push_str(&format!(
            "时间范围: {year}年度\n全年收入: {total_inc} 元\n全年支出: {total_exp} 元\n结余: {} 元\n\n",
            total_inc - total_exp
        ));

        out.push_str("逐月收支:\n");
        if trend.is_empty() {
            out.push_str("（无数据）\n");
        } else {
            for t in &trend {
                out.push_str(&format!(
                    "- {}月: 收入 {} / 支出 {}\n",
                    t.month, t.income, t.expense
                ));
            }
        }
        out.push('\n');

        out.push_str("支出分类 TOP（金额/占比）:\n");
        if exp_cats.is_empty() {
            out.push_str("（无支出）\n");
        } else {
            for c in exp_cats.iter().take(12) {
                out.push_str(&format!(
                    "- {} {}: {} 元 ({:.1}%)\n",
                    c.icon, c.category_name, c.total, c.percentage
                ));
            }
        }
        out.push('\n');

        out.push_str("成员分摊:\n");
        if members.is_empty() {
            out.push_str("（无成员数据）\n");
        } else {
            for mb in members.iter().take(10) {
                out.push_str(&format!("- {}: {} 元\n", mb.member_name, mb.total));
            }
        }
        out.push('\n');

        if !social.is_empty() {
            out.push_str("人情往来:\n");
            for s in social.iter().take(10) {
                out.push_str(&format!(
                    "- {}: 送出 {} / 收到 {} / 净 {}\n",
                    s.person_name, s.given, s.received, s.net
                ));
            }
        }
    }

    Ok(out)
}

pub async fn report_stream(
    pool: &PgPool,
    family_id: Uuid,
    period: String,
    year: i32,
    month: Option<u32>,
) -> Result<impl futures::Stream<Item = Result<Event, Infallible>>, AppError> {
    let llm_config = sqlx::query_as::<_, LlmConfig>(
        "SELECT * FROM llm_configs WHERE family_id = $1 AND is_active = true LIMIT 1",
    )
    .bind(family_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::BadRequest("No active LLM configuration. Please configure one first.".to_string())
    })?;

    let monthly = period != "yearly";
    let context = build_report_context(pool, family_id, monthly, year, month).await?;

    let period_label = if monthly {
        format!("{}年{}月", year, month.unwrap_or(1))
    } else {
        format!("{}年度", year)
    };

    let system_prompt = format!(
        "你是 PenyCounts 的资深家庭财务分析师。请基于用户提供的真实账目数据，输出一份「{period_label}」财务报告。\n\n\
         要求：\n\
         - 用规范 Markdown，分小节：## 总览、## 收支结构、## 重点发现、## 行动建议\n\
         - 语气温暖、像朋友聊天，而不是冷冰冰的报表\n\
         - 多用具体数字与百分比支撑结论，金额用人民币（¥）\n\
         - 既指出做得好的地方，也点出需要注意的地方，给出 2-4 条可执行建议\n\
         - 绝不编造数据中不存在的信息；若某些数据为空，如实说明\n\
         - 直接输出报告正文，不要寒暄开场白"
    );

    let user_content = format!("以下是「{period_label}」的账目数据：\n\n{context}");

    let api_key = llm_config.api_key.unwrap_or_default();
    let api_url = llm_config.api_url.clone();
    let model_name = llm_config.model_name.clone();

    let messages = serde_json::json!([
        { "role": "system", "content": system_prompt },
        { "role": "user", "content": user_content },
    ]);

    let stream = async_stream::stream! {
        let client = reqwest::Client::new();
        let request_body = serde_json::json!({
            "model": model_name,
            "messages": messages,
            "stream": true,
        });

        let response = match client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                yield Ok(Event::default().event("error").data(format!("LLM 请求失败: {}", e)));
                return;
            }
        };

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            yield Ok(Event::default().event("error").data(format!("LLM API 错误: {}", body)));
            return;
        }

        let mut byte_stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut thinking_phase = false;

        while let Some(chunk) = byte_stream.next().await {
            match chunk {
                Ok(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..pos].trim().to_string();
                        buffer = buffer[pos + 1..].to_string();
                        if line.is_empty() { continue; }
                        if line == "data: [DONE]" { break; }
                        if let Some(data) = line.strip_prefix("data: ") {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                                let delta = &parsed["choices"][0]["delta"];
                                let reasoning = delta["reasoning_content"].as_str().unwrap_or("");
                                let content_text = delta["content"].as_str().unwrap_or("");
                                if !reasoning.is_empty() { thinking_phase = true; }
                                if thinking_phase && reasoning.is_empty() && !content_text.is_empty() {
                                    thinking_phase = false;
                                }
                                if !content_text.is_empty() && !thinking_phase {
                                    yield Ok(Event::default().data(content_text));
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    yield Ok(Event::default().event("error").data(e.to_string()));
                    break;
                }
            }
        }

        yield Ok(Event::default().event("done").data("[DONE]"));
    };

    Ok(stream)
}

// ── OCR (photo bookkeeping) ──────────────────────────────────────────

/// Heuristic check for whether a model name is likely vision-capable. There's no
/// universal capability endpoint across OpenAI-compatible providers, so we match
/// on well-known multimodal model families.
pub fn model_supports_vision(model_name: &str) -> bool {
    let m = model_name.to_lowercase();
    const HINTS: &[&str] = &[
        "vl", "vision", "gpt-4o", "4o", "gpt-4.1", "gpt-5", "o4",
        "claude-3", "claude-4", "claude-sonnet", "claude-opus", "claude-haiku",
        "gemini", "qwen-vl", "qwen2-vl", "qwen2.5-vl", "internvl", "llava",
        "pixtral", "glm-4v", "glm-4.1v", "step-1v", "yi-vision", "minicpm-v",
        "grok-vision", "grok-2-vision", "doubao-vision", "ernie-vl",
    ];
    HINTS.iter().any(|h| m.contains(h))
}

pub async fn ocr_availability(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<OcrAvailability, AppError> {
    let config = sqlx::query_as::<_, LlmConfig>(
        "SELECT * FROM llm_configs WHERE family_id = $1 AND is_active = true LIMIT 1",
    )
    .bind(family_id)
    .fetch_optional(pool)
    .await?;

    match config {
        Some(c) => Ok(OcrAvailability {
            available: model_supports_vision(&c.model_name),
            model_name: c.model_name,
        }),
        None => Ok(OcrAvailability {
            available: false,
            model_name: String::new(),
        }),
    }
}

/// Send an image to the configured vision LLM and extract structured
/// transaction fields. `image_data_url` must be a full `data:<mime>;base64,...`.
pub async fn ocr_extract(
    pool: &PgPool,
    family_id: Uuid,
    image_data_url: String,
) -> Result<OcrResult, AppError> {
    let llm_config = sqlx::query_as::<_, LlmConfig>(
        "SELECT * FROM llm_configs WHERE family_id = $1 AND is_active = true LIMIT 1",
    )
    .bind(family_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::BadRequest("未配置 AI 模型，请先在设置中配置".to_string())
    })?;

    // Build the available category list so the model can classify accurately.
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

    let mut category_list = String::new();
    for cat in &categories {
        category_list.push_str(&format!("- {} ({})\n", cat.name, cat.r#type));
        for sub in subcategories.iter().filter(|s| s.category_id == cat.id) {
            category_list.push_str(&format!("  - {}\n", sub.name));
        }
    }

    let today = Local::now().format("%Y-%m-%d").to_string();
    let instruction = format!(
        "你是记账助手。请仔细识别这张图片（可能是支付截图、小票、账单或商品价签），\
         提取其中的一笔交易信息，并只返回一个 JSON 对象，不要包含任何解释或 Markdown 代码块。\n\n\
         可用分类（含子分类）:\n{category_list}\n\
         今天是 {today}。\n\n\
         JSON 字段（缺失则省略该字段）:\n\
         - amount: 金额数字字符串，如 \"38.50\"\n\
         - type: \"income\" 或 \"expense\"（付款/支出为 expense，收款/收入为 income）\n\
         - date: \"YYYY-MM-DD\"，从图片中的时间推断，没有则用今天\n\
         - category_name: 从上面分类中选最匹配的一级分类名\n\
         - subcategory_name: 所选一级分类下的子分类名（可省略）\n\
         - merchant: 商家或对方名称\n\
         - note: 简短备注（如商品名）\n\n\
         只输出 JSON。"
    );

    let request_body = serde_json::json!({
        "model": llm_config.model_name,
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": instruction },
                    { "type": "image_url", "image_url": { "url": image_data_url } }
                ]
            }
        ],
        "max_tokens": 1024,
        "stream": false,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| AppError::Internal(format!("创建请求客户端失败: {e}")))?;

    let mut req = client
        .post(&llm_config.api_url)
        .header("Content-Type", "application/json");
    if let Some(key) = llm_config.api_key.as_deref() {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {key}"));
        }
    }

    let response = req
        .json(&request_body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("调用视觉模型失败: {e}")))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::BadRequest(format!(
            "视觉模型返回错误 ({}): {}",
            status.as_u16(),
            body
        )));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("解析响应失败: {e}")))?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();

    if content.is_empty() {
        return Err(AppError::BadRequest(
            "模型未能识别图片内容，请换一张更清晰的图片".to_string(),
        ));
    }

    let json_str = extract_json_block(&content);
    let result: OcrResult = serde_json::from_str(&json_str).map_err(|_| {
        AppError::BadRequest(format!("无法解析识别结果: {content}"))
    })?;

    Ok(result)
}

// ── Report archive (persisted AI reports) ────────────────────────────

/// Upsert a report for (family, period, year, month). Regenerating the same
/// period overwrites the previous content.
pub async fn save_report(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    req: SaveReportRequest,
) -> Result<AiReport, AppError> {
    if req.period != "monthly" && req.period != "yearly" {
        return Err(AppError::BadRequest("无效的周期".to_string()));
    }
    if req.content.trim().is_empty() {
        return Err(AppError::BadRequest("报告内容为空".to_string()));
    }
    let month = if req.period == "monthly" {
        req.month
    } else {
        None
    };

    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM ai_reports
         WHERE family_id = $1 AND period = $2 AND year = $3
           AND month IS NOT DISTINCT FROM $4",
    )
    .bind(family_id)
    .bind(&req.period)
    .bind(req.year)
    .bind(month)
    .fetch_optional(pool)
    .await?;

    let report = if let Some(id) = existing {
        sqlx::query_as::<_, AiReport>(
            "UPDATE ai_reports
             SET content = $1, model_name = $2, updated_at = now()
             WHERE id = $3
             RETURNING id, period, year, month, content, model_name, created_at, updated_at",
        )
        .bind(&req.content)
        .bind(&req.model_name)
        .bind(id)
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_as::<_, AiReport>(
            "INSERT INTO ai_reports (id, family_id, user_id, period, year, month, content, model_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, period, year, month, content, model_name, created_at, updated_at",
        )
        .bind(Uuid::new_v4())
        .bind(family_id)
        .bind(user_id)
        .bind(&req.period)
        .bind(req.year)
        .bind(month)
        .bind(&req.content)
        .bind(&req.model_name)
        .fetch_one(pool)
        .await?
    };

    Ok(report)
}

pub async fn list_reports(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<Vec<AiReportSummary>, AppError> {
    let rows = sqlx::query_as::<_, AiReportSummary>(
        "SELECT id, period, year, month, model_name, created_at, updated_at
         FROM ai_reports
         WHERE family_id = $1
         ORDER BY updated_at DESC",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_report(
    pool: &PgPool,
    family_id: Uuid,
    report_id: Uuid,
) -> Result<AiReport, AppError> {
    sqlx::query_as::<_, AiReport>(
        "SELECT id, period, year, month, content, model_name, created_at, updated_at
         FROM ai_reports
         WHERE id = $1 AND family_id = $2",
    )
    .bind(report_id)
    .bind(family_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("报告不存在".to_string()))
}

pub async fn delete_report(
    pool: &PgPool,
    family_id: Uuid,
    report_id: Uuid,
) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM ai_reports WHERE id = $1 AND family_id = $2")
        .bind(report_id)
        .bind(family_id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("报告不存在".to_string()));
    }
    Ok(())
}

/// Pull the first JSON object out of a model reply, tolerating ```json fences
/// and surrounding prose.
fn extract_json_block(text: &str) -> String {
    let trimmed = text.trim();
    // Strip a fenced code block if present.
    if let Some(rest) = trimmed.strip_prefix("```") {
        let rest = rest.strip_prefix("json").unwrap_or(rest);
        if let Some(end) = rest.rfind("```") {
            return rest[..end].trim().to_string();
        }
    }
    // Otherwise grab the substring between the first '{' and last '}'.
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            return trimmed[start..=end].to_string();
        }
    }
    trimmed.to_string()
}
