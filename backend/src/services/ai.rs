use std::collections::{BTreeMap, HashSet};
use std::convert::Infallible;
use std::time::Duration;

use axum::response::sse::Event;
use chrono::{DateTime, Datelike, FixedOffset, Local, Utc};
use futures::StreamExt;
use rust_decimal::Decimal;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    AiReport, AiReportSummary, Category, ChatMessage, LlmConfig, LlmConfigRequest, Member,
    OcrAvailability, OcrResult, SaveReportRequest, Subcategory,
};
use crate::services::ai_tools::{self, ToolContext, ToolKind};
use crate::services::{social_gift, stats};

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

/// History rows replayed to the model. A tool turn takes several rows, so this
/// covers roughly the last handful of exchanges.
const HISTORY_WINDOW: i64 = 40;
/// Old query dumps add tokens, not signal; replayed tool results are clipped.
const HISTORY_TOOL_CHARS: usize = 1500;
const MAX_ITERATIONS: usize = 10;

const DUPLICATE_READ_NOTE: &str =
    "（已用相同条件查询过，结果见上文。请不要再调用工具，直接根据上面的数据用中文回答用户的问题。）";
const DUPLICATE_WRITE_NOTE: &str =
    "（这个操作在本轮对话中已经成功执行过，为避免重复记账已跳过。请不要再调用工具，直接用中文简短回复用户。）";

pub async fn get_chat_history(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<Vec<ChatMessage>, AppError> {
    tracing::debug!(family_id = %family_id, "svc::get_chat_history: querying");
    let rows = sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM chat_messages WHERE family_id = $1 ORDER BY created_at ASC",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;
    let messages = fold_for_display(rows);
    tracing::debug!(count = messages.len(), "svc::get_chat_history: done");

    Ok(messages)
}

/// Collapse each agent turn (prose, tool calls, tool results) into a single
/// assistant bubble, matching what the client shows while streaming. Of the
/// tool rows only write confirmations ("✅ …") are user-facing.
fn fold_for_display(rows: Vec<ChatMessage>) -> Vec<ChatMessage> {
    let mut out: Vec<ChatMessage> = Vec::new();
    for row in rows {
        let piece = match row.role.as_str() {
            "user" => {
                if !row.content.trim().is_empty() {
                    out.push(row);
                }
                continue;
            }
            "assistant" => row.content.trim().to_string(),
            "tool" if row.content.trim_start().starts_with('✅') => row
                .content
                .lines()
                .filter(|l| !l.starts_with(ai_tools::RECORD_ID_PREFIX))
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string(),
            _ => continue,
        };
        if piece.is_empty() {
            continue;
        }
        match out.last_mut() {
            Some(last) if last.role == "assistant" => {
                last.content.push_str("\n\n");
                last.content.push_str(&piece);
            }
            _ => out.push(ChatMessage {
                role: "assistant".to_string(),
                content: piece,
                tool_calls: None,
                tool_call_id: None,
                ..row
            }),
        }
    }
    out
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

/// "Now" in the user's timezone. Falls back to the server's local time when the
/// client did not send a (sane) offset.
fn user_now(tz_offset_minutes: Option<i32>) -> DateTime<FixedOffset> {
    tz_offset_minutes
        .filter(|m| m.abs() <= 14 * 60)
        .and_then(|m| FixedOffset::east_opt(m * 60))
        .map(|tz| Utc::now().with_timezone(&tz))
        .unwrap_or_else(|| Local::now().fixed_offset())
}

fn build_system_prompt(now: &DateTime<FixedOffset>, categories: &str, members: &str) -> String {
    const WEEKDAYS: [&str; 7] = ["一", "二", "三", "四", "五", "六", "日"];
    let today = now.date_naive();
    let weekday = WEEKDAYS[today.weekday().num_days_from_monday() as usize];
    let yesterday = today.pred_opt().unwrap_or(today);
    let month_start = today.with_day(1).unwrap_or(today);
    let one_month_ago = today - chrono::Duration::days(30);
    let year = today.year();
    let occasions = social_gift::OCCASIONS.join("、");
    let relations = social_gift::RELATIONS.join("、");

    format!(
        "你是 PenyCounts 家庭记账应用的 AI 助手，可以帮用户记账、查账、改账、删账、做统计分析，以及记录和查询人情往来。\n\n\
         当前时间: {now} 星期{weekday}\n\n\
         ## 可用分类（含子分类）:\n{categories}\n\n\
         ## 已有人员:\n{members}\n\n\
         ## 工具选择\n\
         1. 普通收支 → create_transaction。一次描述多笔时，每笔分别调用一次（可在同一轮并行发起），全部完成后用列表汇总\n\
         2. **人情往来**（给某人或收到某人的红包、礼金、随份子、压岁钱、见面礼、送礼物等，有明确的对方）→ create_social_gift。它会自动记一笔「人情往来/人情收入」账单（对方记为人员）并登记到人情簿，**不要再为同一笔调用 create_transaction**。没有具体对方的（如慈善捐款、请客吃饭）按普通收支记\n\
         3. 查账 → query_transactions；查人情 → query_social_gifts（包含人情分类下的全部账单）\n\
         4. 改/删普通账单 → 先 query_transactions 拿到 ID，再 update_transaction / delete_transaction\n\
         5. 改/删人情 → 先 query_social_gifts 拿到 ID，再 update_social_gift / delete_social_gift（账单会同步）\n\
         6. 刚记完的记录，工具结果里带有「记录ID」，用户紧接着要修改或删除时可直接使用，不必再查\n\
         7. 趋势、占比、人员分摊 → get_statistics\n\n\
         ## 记账规则\n\
         - type: income 或 expense，按语义判断\n\
         - category_name 必须从上面的分类中选，且分类类型要与 type 一致；subcategory_name 只能选该分类名下列出的子分类\n\
         - date: YYYY-MM-DD。「今天」= {today}，「昨天」= {yesterday}；没说日期默认今天；用户给了具体时刻（如 10:28）就填 time\n\
         - members: 涉及的人员（付款人、使用人等），只填姓名\n\
         - 分类之外的细节（商家、物品、地点、谁买的等）写进 note\n\
         - 缺少金额或无法判断收支方向时先追问，不要瞎猜\n\n\
         ## 人情往来规则\n\
         - type: give=我方送出（随礼、发红包、送礼物），receive=我方收到\n\
         - person_name 填**对方**姓名（收礼人或送礼人），不是我方经手人；我方经手人等其他信息写进 note\n\
         - occasion 只能是: {occasions}（结婚/喜酒→婚礼，拜年/压岁钱/春节→节日，看望病人→探病，搬家→乔迁，说不清→其他）\n\
         - kind: 红包 / 礼金 / 礼物（送的是实物时用礼物）\n\
         - relation（可选）: {relations}\n\
         - 示例：\n\
           - 「送张三结婚红包 500」→ type=give, person_name=张三, occasion=婚礼, kind=红包, amount=500\n\
           - 「牛牛生日，陈学华给了 300 红包」→ type=receive, person_name=陈学华, occasion=生日, kind=红包, note=牛牛生日红包\n\
           - 「黄丹丹买补品送给刘长方 164.98，算人情」→ type=give, person_name=刘长方, occasion=其他, kind=礼物, note=黄丹丹买的补品\n\n\
         ## 行为准则\n\
         1. 需要读写数据就直接调用工具，不要在回复里输出 JSON，也不要假装已经完成。「✅ 记账成功」之类的结果由系统在工具成功后自动展示，你不要编造或复述，只需简短确认\n\
         2. 工具返回 Error 时，按提示修正参数后重试一次；仍失败就如实告诉用户原因\n\
         3. 修改或删除前，若不确定是哪条记录先查询；匹配到多条时列出来让用户选\n\
         4. 严格遵守用户指定的时间范围：「4月份」只查 {year}-04-01 至 {year}-04-30；「本月」= {month_start} 至 {today}；「最近一个月」= {one_month_ago} 至 {today}。没有数据就如实说「该时间段没有记录」，不要自行扩大范围\n\
         5. 问「最大/最贵的 N 笔」：query_transactions 设 sort_by=amount_desc、limit=N，直接用返回结果作答\n\
         6. 工具结果已经能回答问题时立即作答，不要换范围重复查询\n\
         7. 闲聊或一般问题直接回答\n\
         8. 回复用规范 Markdown：列举时每条独占一行（「1. 内容」），金额等要点可加粗",
        now = now.format("%Y-%m-%d %H:%M"),
    )
}

fn clip(s: &str, max_chars: usize) -> String {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}…（已截断）", &s[..idx]),
        None => s.to_string(),
    }
}

/// Rebuild an OpenAI-format history including tool calls and tool results. A
/// text-only history (assistant prose with no tool context) taught weak models
/// that "recording" just means replying with a confirmation sentence — so they
/// stopped calling the tools. Replaying the real chain keeps them on track.
fn replay_history(rows_newest_first: Vec<ChatMessage>) -> Vec<Value> {
    let mut msgs: Vec<Value> = Vec::new();
    for msg in rows_newest_first.into_iter().rev() {
        match msg.role.as_str() {
            "tool" => msgs.push(json!({
                "role": "tool",
                "tool_call_id": msg.tool_call_id.unwrap_or_default(),
                "content": clip(&msg.content, HISTORY_TOOL_CHARS),
            })),
            "assistant" => {
                // Strip any legacy "✅ 记账成功！…" echo blocks from older rows.
                let content = strip_tool_echoes(&msg.content);
                let tool_calls = msg
                    .tool_calls
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .filter(|v| v.as_array().is_some_and(|a| !a.is_empty()));
                if content.is_empty() && tool_calls.is_none() {
                    continue;
                }
                let mut m = json!({ "role": "assistant" });
                if !content.is_empty() {
                    m["content"] = Value::String(content);
                }
                if let Some(tc) = tool_calls {
                    m["tool_calls"] = tc;
                }
                msgs.push(m);
            }
            _ => {
                if !msg.content.trim().is_empty() {
                    msgs.push(json!({ "role": "user", "content": msg.content }));
                }
            }
        }
    }
    sanitize_tool_pairs(msgs)
}

/// Enforce the API invariant: an assistant `tool_calls` message must be
/// followed by a tool message for each call id, and tool messages may only
/// answer such a call. The history window or an interrupted stream can break
/// either side; the broken parts are dropped instead of failing the request.
fn sanitize_tool_pairs(msgs: Vec<Value>) -> Vec<Value> {
    let mut out = Vec::with_capacity(msgs.len());
    let mut i = 0;
    while i < msgs.len() {
        let msg = &msgs[i];
        if msg["role"] == "tool" {
            i += 1;
            continue;
        }
        let Some(calls) = msg["tool_calls"].as_array() else {
            out.push(msg.clone());
            i += 1;
            continue;
        };

        let mut end = i + 1;
        while end < msgs.len() && msgs[end]["role"] == "tool" {
            end += 1;
        }
        let results = &msgs[i + 1..end];
        let ids: HashSet<&str> = calls.iter().filter_map(|c| c["id"].as_str()).collect();
        let answered: HashSet<&str> =
            results.iter().filter_map(|t| t["tool_call_id"].as_str()).collect();

        if !ids.is_empty() && ids.len() == calls.len() && ids.is_subset(&answered) {
            out.push(msg.clone());
            out.extend(
                results
                    .iter()
                    .filter(|t| t["tool_call_id"].as_str().is_some_and(|id| ids.contains(id)))
                    .cloned(),
            );
        } else if let Some(text) = msg["content"].as_str().filter(|c| !c.is_empty()) {
            out.push(json!({ "role": "assistant", "content": text }));
        }
        i = end;
    }
    out
}

#[derive(Default)]
struct PendingToolCall {
    id: String,
    name: String,
    args: String,
}

impl PendingToolCall {
    /// Name plus canonicalized arguments, used to spot repeated calls.
    fn signature(&self) -> String {
        let args = serde_json::from_str::<Value>(&self.args)
            .map(|v| v.to_string())
            .unwrap_or_else(|_| self.args.trim().to_string());
        format!("{}|{}", self.name, args)
    }

    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "type": "function",
            "function": { "name": self.name, "arguments": self.args },
        })
    }
}

/// Slot a streamed tool-call fragment belongs to. Some providers omit `index`
/// and send each call whole; then a known id continues its call, and a fragment
/// carrying a function name starts a new one.
fn tool_call_slot(pending: &BTreeMap<usize, PendingToolCall>, call: &Value) -> usize {
    if let Some(i) = call["index"].as_u64() {
        return i as usize;
    }
    if let Some(id) = call["id"].as_str().filter(|s| !s.is_empty()) {
        if let Some((&slot, _)) = pending.iter().find(|(_, c)| c.id == id) {
            return slot;
        }
    }
    let starts_new = call["function"]["name"].as_str().is_some_and(|n| !n.is_empty());
    match pending.last_key_value() {
        Some((&last, _)) if starts_new => last + 1,
        Some((&last, _)) => last,
        None => 0,
    }
}

/// Merge streamed tool-call fragments into complete calls.
fn accumulate_tool_calls(pending: &mut BTreeMap<usize, PendingToolCall>, calls: &[Value]) {
    for call in calls {
        let slot = tool_call_slot(pending, call);
        let entry = pending.entry(slot).or_default();
        if let Some(id) = call["id"].as_str().filter(|s| !s.is_empty()) {
            entry.id = id.to_string();
        }
        if let Some(name) = call["function"]["name"].as_str().filter(|s| !s.is_empty()) {
            // Most providers send the name once; some repeat it on every chunk.
            if entry.name != name {
                entry.name.push_str(name);
            }
        }
        match &call["function"]["arguments"] {
            Value::String(s) => entry.args.push_str(s),
            Value::Null => {}
            // Ollama-style providers send the arguments as an object.
            other => entry.args.push_str(&other.to_string()),
        }
    }
}

fn finalize_tool_calls(pending: BTreeMap<usize, PendingToolCall>) -> Vec<PendingToolCall> {
    pending
        .into_values()
        .filter(|c| !c.name.is_empty())
        .map(|mut c| {
            if c.id.is_empty() {
                c.id = format!("call_{}", Uuid::new_v4().simple());
            }
            if c.args.trim().is_empty() {
                c.args = "{}".to_string();
            }
            c
        })
        .collect()
}

struct PersistRow {
    role: &'static str,
    content: String,
    tool_calls: Option<String>,
    tool_call_id: Option<String>,
}

/// Save chat rows in the background. Rows are stamped `base + seq` ms up front
/// so they keep their order even though each batch lands independently — and
/// they still land if the client disconnects mid-stream.
fn spawn_persist(ctx: &ToolContext, base: DateTime<Utc>, seq: &mut i64, rows: Vec<PersistRow>) {
    let first = *seq;
    *seq += rows.len() as i64;
    let pool = ctx.pool.clone();
    let (user_id, family_id) = (ctx.user_id, ctx.family_id);
    tokio::spawn(async move {
        for (i, row) in rows.into_iter().enumerate() {
            let created_at = base + chrono::Duration::milliseconds(first + i as i64);
            let result = sqlx::query(
                "INSERT INTO chat_messages
                    (id, user_id, family_id, role, content, tool_calls, tool_call_id, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(Uuid::new_v4())
            .bind(user_id)
            .bind(family_id)
            .bind(row.role)
            .bind(row.content)
            .bind(row.tool_calls)
            .bind(row.tool_call_id)
            .bind(created_at)
            .execute(&pool)
            .await;
            if let Err(e) = result {
                tracing::warn!(error = %e, "agent loop: failed to persist chat row");
            }
        }
    });
}

/// HTTP client for streaming LLM calls.
fn llm_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // Per-read: reasoning models may pause for a while between tokens.
        .read_timeout(Duration::from_secs(180))
        .build()
}

fn describe_request_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "请求超时，模型长时间没有响应".to_string()
    } else if e.is_connect() {
        "无法连接到模型服务，请检查 API 地址".to_string()
    } else {
        e.to_string()
    }
}

/// Pop complete lines off `buf`. Lines are decoded only once whole, so a
/// multi-byte UTF-8 character split across network chunks stays intact.
fn take_lines(buf: &mut Vec<u8>) -> Vec<String> {
    let mut lines = Vec::new();
    while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
        let line: Vec<u8> = buf.drain(..=pos).collect();
        lines.push(String::from_utf8_lossy(&line).trim().to_string());
    }
    lines
}

/// The final line once the body ends without a trailing newline.
fn take_rest(buf: &mut Vec<u8>) -> Vec<String> {
    let rest = String::from_utf8_lossy(&std::mem::take(buf)).trim().to_string();
    if rest.is_empty() { Vec::new() } else { vec![rest] }
}

fn sse_data(line: &str) -> Option<&str> {
    line.strip_prefix("data:").map(str::trim_start)
}

/// Providers sometimes report failures inside the stream as `{"error": …}`.
fn provider_error(chunk: &Value) -> Option<String> {
    let err = chunk.get("error").filter(|e| !e.is_null())?;
    Some(
        err.get("message")
            .and_then(Value::as_str)
            .map_or_else(|| err.to_string(), String::from),
    )
}

pub async fn chat_stream(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    message: String,
    tz_offset_minutes: Option<i32>,
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

    let now = user_now(tz_offset_minutes);
    let tree = ai_tools::CategoryTree::load(pool, family_id).await?;
    let members = sqlx::query_as::<_, Member>(
        "SELECT * FROM members WHERE family_id = $1 ORDER BY name",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;
    let member_list = if members.is_empty() {
        "暂无".to_string()
    } else {
        members.iter().map(|m| m.name.as_str()).collect::<Vec<_>>().join("、")
    };
    let system_prompt = build_system_prompt(&now, &tree.prompt_listing(), &member_list);

    let history = sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM chat_messages WHERE family_id = $1 ORDER BY created_at DESC LIMIT $2",
    )
    .bind(family_id)
    .bind(HISTORY_WINDOW)
    .fetch_all(pool)
    .await?;

    let mut messages = vec![json!({ "role": "system", "content": system_prompt })];
    messages.extend(replay_history(history));
    let tools = ai_tools::definitions();

    let api_key = llm_config.api_key.unwrap_or_default();
    let api_url = llm_config.api_url;
    let model_name = llm_config.model_name;
    let ctx = ToolContext { pool: pool.clone(), user_id, family_id, now };

    let stream = async_stream::stream! {
        let client = match llm_client() {
            Ok(c) => c,
            Err(e) => {
                yield Ok(Event::default().event("error").data(format!("创建请求客户端失败: {e}")));
                yield Ok(Event::default().data("[DONE]"));
                return;
            }
        };

        let persist_base = Utc::now();
        let mut persist_seq: i64 = 0;

        // Loop guards for weak models: a repeated read is answered from the
        // earlier result, and a write that already succeeded in an earlier
        // round is not replayed (identical writes within one round are a real
        // batch, e.g. two identical coffees).
        let mut executed_reads: HashSet<String> = HashSet::new();
        let mut completed_writes: HashSet<String> = HashSet::new();
        let mut force_final = false;
        // Whether the reply bubble has text yet, and whether the next round's
        // prose needs a paragraph break after tool output.
        let mut shown_any = false;
        let mut needs_break = false;

        for iteration in 0..MAX_ITERATIONS {
            let last_round = iteration + 1 == MAX_ITERATIONS;
            tracing::debug!(iteration, force_final, "agent loop: starting iteration");

            let mut request_body = json!({
                "model": model_name,
                "messages": messages,
                "stream": true,
                "tools": tools,
            });
            if force_final || last_round {
                // Stop offering tools so the model answers from what it has.
                request_body["tool_choice"] = json!("none");
            }

            let mut request = client.post(&api_url).header("Content-Type", "application/json");
            if !api_key.is_empty() {
                request = request.bearer_auth(&api_key);
            }
            let response = match request.json(&request_body).send().await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!(error = %e, "agent loop: LLM request failed");
                    yield Ok(Event::default().event("error").data(format!("LLM 请求失败: {}", describe_request_error(&e))));
                    break;
                }
            };
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                tracing::error!(%status, body = %body, "agent loop: LLM API error");
                yield Ok(Event::default().event("error").data(format!("LLM API 错误 ({}): {}", status.as_u16(), body)));
                break;
            }

            // Stream one LLM turn, accumulating prose and tool calls.
            let mut turn_content = String::new();
            let mut pending: BTreeMap<usize, PendingToolCall> = BTreeMap::new();
            let mut thinking = false;
            let mut stream_error: Option<String> = None;
            let mut buf: Vec<u8> = Vec::new();
            let mut body = response.bytes_stream();
            let mut finished = false;

            while !finished {
                let lines = match body.next().await {
                    Some(Ok(chunk)) => {
                        buf.extend_from_slice(&chunk);
                        take_lines(&mut buf)
                    }
                    Some(Err(e)) => {
                        stream_error = Some(format!("读取模型响应失败: {}", describe_request_error(&e)));
                        break;
                    }
                    None => {
                        finished = true;
                        take_rest(&mut buf)
                    }
                };

                for line in lines {
                    let Some(data) = sse_data(&line) else { continue };
                    if data == "[DONE]" {
                        finished = true;
                        break;
                    }
                    let Ok(chunk) = serde_json::from_str::<Value>(data) else { continue };
                    if let Some(err) = provider_error(&chunk) {
                        stream_error = Some(format!("LLM API 错误: {err}"));
                        finished = true;
                        break;
                    }

                    let delta = &chunk["choices"][0]["delta"];
                    let reasoning = delta["reasoning_content"]
                        .as_str()
                        .or_else(|| delta["reasoning"].as_str())
                        .unwrap_or("");
                    let text = delta["content"].as_str().unwrap_or("");
                    // Reasoning models (DeepSeek R1 etc.): hide the thinking
                    // phase, including content that leaks alongside it.
                    if !reasoning.is_empty() {
                        thinking = true;
                    } else if thinking && !text.is_empty() {
                        thinking = false;
                    }
                    if !text.is_empty() && !thinking {
                        if needs_break {
                            needs_break = false;
                            if shown_any {
                                yield Ok(Event::default().data("\n\n"));
                            }
                        }
                        turn_content.push_str(text);
                        shown_any = true;
                        yield Ok(Event::default().data(text));
                    }

                    if let Some(calls) = delta["tool_calls"].as_array() {
                        accumulate_tool_calls(&mut pending, calls);
                    }
                }
            }

            if let Some(err) = stream_error {
                tracing::error!(error = %err, "agent loop: stream error");
                yield Ok(Event::default().event("error").data(err));
                break;
            }

            let calls = finalize_tool_calls(pending);

            // No tool calls → this turn's prose is the final answer.
            if calls.is_empty() {
                tracing::debug!(iteration, "agent loop: no tool calls, done");
                if !turn_content.trim().is_empty() {
                    let row = PersistRow { role: "assistant", content: turn_content, tool_calls: None, tool_call_id: None };
                    spawn_persist(&ctx, persist_base, &mut persist_seq, vec![row]);
                }
                break;
            }

            if last_round {
                tracing::warn!(iteration, "agent loop: iteration cap reached with pending tool calls");
                let note = "（操作步骤过多，已停止。请把需求拆小一些再试。）";
                yield Ok(Event::default().data(if shown_any { format!("\n\n{note}") } else { note.to_string() }));
                break;
            }

            // The model ignored tool_choice=none and keeps repeating reads it already ran.
            if force_final && calls.iter().all(|c| executed_reads.contains(&c.signature())) {
                tracing::warn!(iteration, "agent loop: model stuck repeating tool calls, breaking");
                break;
            }

            tracing::debug!(iteration, count = calls.len(), "agent loop: executing tool calls");

            let tc_json: Vec<Value> = calls.iter().map(PendingToolCall::to_json).collect();
            let mut assistant_msg = json!({ "role": "assistant", "tool_calls": tc_json });
            if !turn_content.is_empty() {
                assistant_msg["content"] = Value::String(turn_content.clone());
            }
            messages.push(assistant_msg);

            let mut rows = vec![PersistRow {
                role: "assistant",
                content: turn_content,
                tool_calls: serde_json::to_string(&tc_json).ok(),
                tool_call_id: None,
            }];
            let mut succeeded_writes: Vec<String> = Vec::new();

            for call in &calls {
                let signature = call.signature();
                let kind = ai_tools::tool_kind(&call.name);

                let content = if kind == ToolKind::Read && !executed_reads.insert(signature.clone()) {
                    tracing::warn!(tool = %call.name, "agent loop: duplicate read, skipping");
                    force_final = true;
                    DUPLICATE_READ_NOTE.to_string()
                } else if kind == ToolKind::Write && completed_writes.contains(&signature) {
                    tracing::warn!(tool = %call.name, "agent loop: repeated write, skipping");
                    force_final = true;
                    DUPLICATE_WRITE_NOTE.to_string()
                } else {
                    tracing::debug!(tool = %call.name, args = %call.args, "agent loop: executing tool");
                    let outcome = ai_tools::execute(&ctx, &call.name, &call.args).await;
                    if kind == ToolKind::Write {
                        let payload = match &outcome {
                            Ok(out) => json!({ "success": true, "tool": call.name, "summary": out.text }),
                            Err(err) => json!({ "success": false, "tool": call.name, "error": err }),
                        };
                        yield Ok(Event::default().event("tool_result").data(payload.to_string()));
                        shown_any = true;
                        if outcome.is_ok() {
                            succeeded_writes.push(signature);
                        }
                    }
                    match outcome {
                        Ok(out) => out.for_model(),
                        Err(err) => {
                            tracing::warn!(tool = %call.name, error = %err, "agent loop: tool failed");
                            format!("Error: {err}")
                        }
                    }
                };

                messages.push(json!({ "role": "tool", "tool_call_id": call.id, "content": content }));
                rows.push(PersistRow {
                    role: "tool",
                    content,
                    tool_calls: None,
                    tool_call_id: Some(call.id.clone()),
                });
            }

            completed_writes.extend(succeeded_writes);
            needs_break = true;
            spawn_persist(&ctx, persist_base, &mut persist_seq, rows);
        }

        yield Ok(Event::default().data("[DONE]"));
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
        let client = match llm_client() {
            Ok(c) => c,
            Err(e) => {
                yield Ok(Event::default().event("error").data(format!("创建请求客户端失败: {e}")));
                return;
            }
        };
        let request_body = json!({
            "model": model_name,
            "messages": messages,
            "stream": true,
        });

        let mut request = client.post(&api_url).header("Content-Type", "application/json");
        if !api_key.is_empty() {
            request = request.bearer_auth(&api_key);
        }
        let response = match request.json(&request_body).send().await {
            Ok(r) => r,
            Err(e) => {
                yield Ok(Event::default().event("error").data(format!("LLM 请求失败: {}", describe_request_error(&e))));
                return;
            }
        };

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            yield Ok(Event::default().event("error").data(format!("LLM API 错误: {}", body)));
            return;
        }

        let mut body = response.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        let mut thinking = false;
        let mut finished = false;

        while !finished {
            let lines = match body.next().await {
                Some(Ok(chunk)) => {
                    buf.extend_from_slice(&chunk);
                    take_lines(&mut buf)
                }
                Some(Err(e)) => {
                    yield Ok(Event::default().event("error").data(describe_request_error(&e)));
                    break;
                }
                None => {
                    finished = true;
                    take_rest(&mut buf)
                }
            };
            for line in lines {
                let Some(data) = sse_data(&line) else { continue };
                if data == "[DONE]" {
                    finished = true;
                    break;
                }
                let Ok(chunk) = serde_json::from_str::<Value>(data) else { continue };
                if let Some(err) = provider_error(&chunk) {
                    yield Ok(Event::default().event("error").data(format!("LLM API 错误: {err}")));
                    finished = true;
                    break;
                }
                let delta = &chunk["choices"][0]["delta"];
                let reasoning = delta["reasoning_content"]
                    .as_str()
                    .or_else(|| delta["reasoning"].as_str())
                    .unwrap_or("");
                let text = delta["content"].as_str().unwrap_or("");
                if !reasoning.is_empty() {
                    thinking = true;
                } else if thinking && !text.is_empty() {
                    thinking = false;
                }
                if !text.is_empty() && !thinking {
                    yield Ok(Event::default().data(text));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_lines_keeps_utf8_split_across_chunks() {
        let line = "data: {\"content\":\"人情\"}\n".as_bytes();
        // Cut inside the 3-byte encoding of 人.
        let cut = line.iter().position(|&b| b >= 0x80).unwrap() + 1;
        let mut buf = line[..cut].to_vec();
        assert!(take_lines(&mut buf).is_empty());
        buf.extend_from_slice(&line[cut..]);
        assert_eq!(take_lines(&mut buf), vec!["data: {\"content\":\"人情\"}"]);
        assert!(buf.is_empty());
    }

    #[test]
    fn accumulates_streamed_and_whole_tool_calls() {
        let mut pending = BTreeMap::new();
        accumulate_tool_calls(
            &mut pending,
            &[json!({ "index": 0, "id": "a", "function": { "name": "create_social_gift", "arguments": "{\"amount\"" } })],
        );
        accumulate_tool_calls(
            &mut pending,
            &[json!({ "index": 0, "function": { "name": "create_social_gift", "arguments": ":500}" } })],
        );
        // Provider without `index`, arguments as an object.
        accumulate_tool_calls(
            &mut pending,
            &[
                json!({ "id": "b", "function": { "name": "query_transactions", "arguments": { "x": 1 } } }),
                json!({ "function": { "name": "get_statistics", "arguments": "{}" } }),
            ],
        );
        let calls = finalize_tool_calls(pending);
        let names: Vec<&str> = calls.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["create_social_gift", "query_transactions", "get_statistics"]);
        assert_eq!(calls[0].args, "{\"amount\":500}");
        assert_eq!(calls[1].args, "{\"x\":1}");
        assert!(calls[2].id.starts_with("call_"));
    }

    #[test]
    fn sanitize_drops_unanswered_tool_calls_and_orphans() {
        let msgs = vec![
            json!({ "role": "tool", "tool_call_id": "x", "content": "orphan" }),
            json!({ "role": "user", "content": "hi" }),
            json!({ "role": "assistant", "content": "ok", "tool_calls": [{ "id": "a" }, { "id": "b" }] }),
            json!({ "role": "tool", "tool_call_id": "a", "content": "r" }),
            json!({ "role": "assistant", "tool_calls": [{ "id": "c" }] }),
            json!({ "role": "tool", "tool_call_id": "c", "content": "r" }),
        ];
        let out = sanitize_tool_pairs(msgs);
        let roles: Vec<&str> = out.iter().map(|m| m["role"].as_str().unwrap()).collect();
        assert_eq!(roles, ["user", "assistant", "assistant", "tool"]);
        assert!(out[1].get("tool_calls").is_none());
        assert_eq!(out[3]["tool_call_id"], "c");
    }

    #[test]
    fn history_folds_turn_into_one_bubble() {
        let row = |role: &str, content: &str| ChatMessage {
            id: Uuid::new_v4(),
            user_id: Uuid::nil(),
            family_id: Uuid::nil(),
            role: role.to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
            created_at: Utc::now(),
        };
        let out = fold_for_display(vec![
            row("user", "送张三红包 500"),
            row("assistant", ""),
            row("tool", "\n\n✅ 人情记录成功！\n送出 张三 500.00 CNY\n（记录ID: abc）"),
            row("tool", "查询结果…"),
            row("assistant", "已记录"),
        ]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[1].content, "✅ 人情记录成功！\n送出 张三 500.00 CNY\n\n已记录");
    }
}
