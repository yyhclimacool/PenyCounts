//! Tools the AI bookkeeping agent can call: JSON schemas and execution.

use std::collections::{BTreeMap, HashMap};
use std::str::FromStr;

use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, NaiveTime};
use rust_decimal::Decimal;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    Category, CreateSocialGiftRequest, CreateTransactionRequest, SocialGift, Subcategory,
    Transaction,
};
use crate::services::social_gift::{self, LedgerTarget};
use crate::services::{stats, transaction};

/// Marks the record-id line appended to write results for the model; the chat
/// history view strips it so users never see raw UUIDs.
pub const RECORD_ID_PREFIX: &str = "（记录ID:";

/// Upper bound on rows a single query tool returns to the model.
const QUERY_ROW_CAP: i64 = 300;

/// Per-request state the tools run against.
pub struct ToolContext {
    pub pool: PgPool,
    pub user_id: Uuid,
    pub family_id: Uuid,
    /// "Now" in the user's timezone; drives default dates and times.
    pub now: DateTime<FixedOffset>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolKind {
    Read,
    Write,
    Unknown,
}

pub fn tool_kind(name: &str) -> ToolKind {
    match name {
        "query_transactions" | "get_statistics" | "query_social_gifts" => ToolKind::Read,
        "create_transaction" | "update_transaction" | "delete_transaction"
        | "create_social_gift" | "update_social_gift" | "delete_social_gift" => ToolKind::Write,
        _ => ToolKind::Unknown,
    }
}

/// Result of a tool call. `text` goes to the model and, for writes, is shown to
/// the user as the confirmation; `record_id` is only appended for the model so
/// a follow-up like "改成60" can target the record without another query.
pub struct ToolOutput {
    pub text: String,
    pub record_id: Option<Uuid>,
}

impl ToolOutput {
    fn new(text: String) -> Self {
        Self { text, record_id: None }
    }

    fn with_id(text: String, id: Uuid) -> Self {
        Self { text, record_id: Some(id) }
    }

    pub fn for_model(&self) -> String {
        match self.record_id {
            Some(id) => format!("{}\n{} {}）", self.text, RECORD_ID_PREFIX, id),
            None => self.text.clone(),
        }
    }
}

pub async fn execute(ctx: &ToolContext, name: &str, raw_args: &str) -> Result<ToolOutput, String> {
    let args = parse_args(raw_args)?;
    match name {
        "create_transaction" => create_transaction(ctx, &args).await,
        "query_transactions" => query_transactions(ctx, &args).await,
        "update_transaction" => update_transaction(ctx, &args).await,
        "delete_transaction" => delete_transaction(ctx, &args).await,
        "get_statistics" => get_statistics(ctx, &args).await,
        "create_social_gift" => create_social_gift(ctx, &args).await,
        "query_social_gifts" => query_social_gifts(ctx, &args).await,
        "update_social_gift" => update_social_gift(ctx, &args).await,
        "delete_social_gift" => delete_social_gift(ctx, &args).await,
        other => Err(format!("未知工具: {other}")),
    }
}

// ── Schemas ──────────────────────────────────────────────────────────

fn function(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            }
        }
    })
}

pub fn definitions() -> Value {
    let date = |what: &str| json!({ "type": "string", "description": format!("{what}，格式 YYYY-MM-DD") });
    let gift_type = json!({
        "type": "string",
        "enum": ["give", "receive"],
        "description": "give=我方送出（随礼、发红包、送礼物），receive=我方收到"
    });

    json!([
        function(
            "create_transaction",
            "新增一笔普通收支账单。用户一次描述多笔时，为每一笔分别调用一次（可在同一轮并行发起多个调用）。\
             给某人/收到某人的红包、礼金、随礼、礼物等人情往来请改用 create_social_gift，不要用本工具。",
            json!({
                "type": { "type": "string", "enum": ["income", "expense"], "description": "收支类型：income=收入，expense=支出" },
                "amount": { "type": "number", "description": "金额（正数，单位：元）" },
                "category_name": { "type": "string", "description": "一级分类名，必须从可用分类中选择，且分类类型与 type 一致" },
                "subcategory_name": { "type": "string", "description": "二级分类名（可选），必须是所选一级分类名下列出的子分类" },
                "date": date("日期（可选，默认今天）"),
                "time": { "type": "string", "description": "时间 HH:MM（可选，用户说了具体时刻才填，默认当前时间）" },
                "members": { "type": "array", "items": { "type": "string" }, "description": "涉及的人员姓名（可选），如付款人、使用人" },
                "note": { "type": "string", "description": "备注（可选）：商家、物品、地点等补充信息" },
                "currency": { "type": "string", "description": "币种代码（可选，默认 CNY）" }
            }),
            &["type", "amount", "category_name"],
        ),
        function(
            "query_transactions",
            "按条件查询账单明细，并返回该范围的收支合计。问「最大/最贵的 N 笔」时设置 sort_by=amount_desc、limit=N。\
             返回的 [ID] 可用于 update_transaction / delete_transaction。",
            json!({
                "start_date": date("起始日期（含），严格按用户指定的范围"),
                "end_date": date("结束日期（含），严格按用户指定的范围"),
                "type": { "type": "string", "enum": ["income", "expense"], "description": "只看收入或支出（可选）" },
                "category_name": { "type": "string", "description": "一级分类或子分类名（可选）" },
                "member_name": { "type": "string", "description": "涉及的人员姓名（可选）" },
                "keyword": { "type": "string", "description": "在备注、地点、人员中模糊搜索的关键词（可选），如「打车」「盒马」" },
                "sort_by": { "type": "string", "enum": ["date_desc", "amount_desc"], "description": "排序（可选）：date_desc=按日期倒序（默认），amount_desc=按金额从大到小" },
                "limit": { "type": "integer", "description": "最多返回多少条（可选，默认 100，最大 200）" }
            }),
            &["start_date", "end_date"],
        ),
        function(
            "update_transaction",
            "修改一条已有账单，只需提供要改的字段，其余保持不变。不确定 ID 时先用 query_transactions 查询。",
            json!({
                "transaction_id": { "type": "string", "description": "账单 ID（完整 UUID）" },
                "type": { "type": "string", "enum": ["income", "expense"], "description": "新的收支类型（改类型时须同时给出新分类）" },
                "amount": { "type": "number", "description": "新金额" },
                "category_name": { "type": "string", "description": "新的一级分类名" },
                "subcategory_name": { "type": "string", "description": "新的二级分类名" },
                "date": date("新日期"),
                "time": { "type": "string", "description": "新时间 HH:MM" },
                "members": { "type": "array", "items": { "type": "string" }, "description": "新的人员列表（整体替换）" },
                "note": { "type": "string", "description": "新备注（传空字符串表示清空）" }
            }),
            &["transaction_id"],
        ),
        function(
            "delete_transaction",
            "删除一条账单。不确定 ID 时先用 query_transactions 查询。",
            json!({
                "transaction_id": { "type": "string", "description": "账单 ID（完整 UUID）" }
            }),
            &["transaction_id"],
        ),
        function(
            "get_statistics",
            "获取统计数据：月度收支趋势、一级分类占比、子分类明细、人员分摊。",
            json!({
                "stat_type": {
                    "type": "string",
                    "enum": ["monthly_trend", "category_breakdown", "subcategory_breakdown", "member_breakdown"],
                    "description": "monthly_trend=某年逐月收支，category_breakdown=一级分类占比，subcategory_breakdown=子分类明细，member_breakdown=人员分摊"
                },
                "year": { "type": "integer", "description": "年份" },
                "month": { "type": "integer", "description": "月份 1-12（可选，不填为全年）" },
                "type": { "type": "string", "enum": ["income", "expense"], "description": "收入或支出（默认支出，monthly_trend 不需要）" },
                "category_name": { "type": "string", "description": "仅 subcategory_breakdown：只看该一级分类下的子分类（可选）" }
            }),
            &["stat_type", "year"],
        ),
        function(
            "create_social_gift",
            "记录一笔人情往来（给某人或收到某人的红包、礼金、随份子、压岁钱、见面礼、礼物等）。\
             会同时生成一笔「人情往来/人情收入」账单（对方记为人员）并登记到人情簿，所以不要再为同一笔调用 create_transaction。",
            json!({
                "type": gift_type,
                "person_name": { "type": "string", "description": "对方姓名（收礼人或送礼人），不是我方经手人" },
                "amount": { "type": "number", "description": "金额（礼物填购买金额）" },
                "occasion": { "type": "string", "enum": social_gift::OCCASIONS, "description": "事由" },
                "kind": { "type": "string", "enum": social_gift::KINDS, "description": "形式：红包 / 礼金 / 礼物（送实物时用礼物）" },
                "relation": { "type": "string", "enum": social_gift::RELATIONS, "description": "与对方的关系（可选）" },
                "date": date("日期（可选，默认今天）"),
                "time": { "type": "string", "description": "时间 HH:MM（可选）" },
                "note": { "type": "string", "description": "补充说明（可选），如我方经手人、具体物品、为谁的事" }
            }),
            &["type", "person_name", "amount"],
        ),
        function(
            "query_social_gifts",
            "查询人情往来：包含人情分类下的全部账单和人情簿记录，返回明细、送出/收到合计和按人汇总。\
             返回的 [ID] 可用于 update_social_gift / delete_social_gift。",
            json!({
                "start_date": date("起始日期（可选，不填不限）"),
                "end_date": date("结束日期（可选，不填不限）"),
                "person_name": { "type": "string", "description": "对方姓名（可选，模糊匹配）" },
                "type": gift_type.clone()
            }),
            &[],
        ),
        function(
            "update_social_gift",
            "修改一条人情记录，账单会同步更新。只需提供要改的字段。不确定 ID 时先用 query_social_gifts 查询。",
            json!({
                "record_id": { "type": "string", "description": "query_social_gifts 返回的记录 ID（完整 UUID）" },
                "type": gift_type.clone(),
                "person_name": { "type": "string", "description": "新的对方姓名" },
                "amount": { "type": "number", "description": "新金额" },
                "occasion": { "type": "string", "enum": social_gift::OCCASIONS, "description": "新事由" },
                "kind": { "type": "string", "enum": social_gift::KINDS, "description": "新形式" },
                "relation": { "type": "string", "enum": social_gift::RELATIONS, "description": "新关系" },
                "date": date("新日期"),
                "note": { "type": "string", "description": "新备注" }
            }),
            &["record_id"],
        ),
        function(
            "delete_social_gift",
            "删除一条人情记录（对应账单一并删除）。不确定 ID 时先用 query_social_gifts 查询。",
            json!({
                "record_id": { "type": "string", "description": "query_social_gifts 返回的记录 ID（完整 UUID）" }
            }),
            &["record_id"],
        ),
    ])
}

// ── Argument parsing ─────────────────────────────────────────────────
//
// Models are sloppy with types ("50" vs 50, "2026/9/1", amounts with "元"), so
// parsing is lenient and errors are phrased for the model to self-correct.

fn parse_args(raw: &str) -> Result<Value, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(json!({}));
    }
    let mut value: Value =
        serde_json::from_str(raw).map_err(|e| format!("参数不是合法的 JSON: {e}"))?;
    // Some models double-encode the arguments as a JSON string.
    if let Value::String(inner) = &value {
        value = serde_json::from_str(inner).map_err(|e| format!("参数不是合法的 JSON: {e}"))?;
    }
    if !value.is_object() {
        return Err("参数必须是 JSON 对象".to_string());
    }
    Ok(value)
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)?.as_str().map(str::trim).filter(|s| !s.is_empty())
}

fn arg_amount(args: &Value, key: &str) -> Result<Option<Decimal>, String> {
    let raw = match args.get(key) {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) if s.trim().is_empty() => return Ok(None),
        Some(Value::String(s)) => s
            .chars()
            .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
            .collect(),
        Some(other) => return Err(format!("{key} 必须是数字，收到 {other}")),
    };
    let value = Decimal::from_str(&raw)
        .or_else(|_| Decimal::from_scientific(&raw))
        .map_err(|_| format!("{key} 不是有效金额：{raw}"))?;
    let amount = value.abs().round_dp(2);
    if amount.is_zero() {
        return Err(format!("{key} 必须大于 0"));
    }
    Ok(Some(amount))
}

fn arg_date(args: &Value, key: &str) -> Result<Option<NaiveDate>, String> {
    let Some(s) = arg_str(args, key) else {
        return Ok(None);
    };
    // Tolerate a trailing time part ("2026-09-01T00:00:00").
    let day = s.get(..10).unwrap_or(s);
    ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"]
        .iter()
        .find_map(|f| NaiveDate::parse_from_str(day, f).ok().or_else(|| NaiveDate::parse_from_str(s, f).ok()))
        .map(Some)
        .ok_or_else(|| format!("{key} 日期格式应为 YYYY-MM-DD，收到「{s}」"))
}

fn arg_time(args: &Value, key: &str) -> Option<NaiveTime> {
    let s = arg_str(args, key)?;
    NaiveTime::parse_from_str(s, "%H:%M:%S")
        .or_else(|_| NaiveTime::parse_from_str(s, "%H:%M"))
        .ok()
}

fn arg_i64(args: &Value, key: &str) -> Option<i64> {
    match args.get(key)? {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// A list of names given as an array or a "张三、李四" string. `None` means the
/// key was absent; `Some(vec![])` means it was explicitly emptied.
fn arg_list(args: &Value, key: &str) -> Option<Vec<String>> {
    let items: Vec<String> = match args.get(key)? {
        Value::Array(a) => a.iter().filter_map(Value::as_str).map(String::from).collect(),
        Value::String(s) => s.split(['、', ',', '，', ' ']).map(String::from).collect(),
        _ => return None,
    };
    let mut out: Vec<String> = Vec::new();
    for item in items.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if !out.iter().any(|o| o == item) {
            out.push(item.to_string());
        }
    }
    Some(out)
}

fn arg_uuid(args: &Value, key: &str) -> Result<Uuid, String> {
    let raw = arg_str(args, key).ok_or_else(|| format!("缺少 {key}"))?;
    let s = raw.trim_matches(|c| c == '[' || c == ']');
    Uuid::parse_str(s).map_err(|_| format!("{key} 不是有效的记录 ID（需要完整 UUID）：{raw}"))
}

fn txn_type(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_lowercase().as_str() {
        "income" | "收入" => Ok("income"),
        "expense" | "支出" => Ok("expense"),
        other => Err(format!("type 只能是 income（收入）或 expense（支出），收到「{other}」")),
    }
}

/// The gift form (红包 / 礼金 / 礼物), mapped from looser wording.
fn kind_arg(args: &Value) -> Option<String> {
    let raw = arg_str(args, "kind")?;
    let kind = if social_gift::KINDS.contains(&raw) {
        raw
    } else if raw.contains('物') {
        "礼物"
    } else if raw.contains("礼金") || raw.contains("现金") || raw.contains("份子") {
        "礼金"
    } else if raw.contains("红包") || raw.contains("压岁") {
        "红包"
    } else {
        return None;
    };
    Some(kind.to_string())
}

fn gift_type_arg(args: &Value) -> Result<Option<&'static str>, String> {
    arg_str(args, "type")
        .map(|t| {
            social_gift::normalize_gift_type(t)
                .ok_or_else(|| format!("type 只能是 give（送出）或 receive（收到），收到「{t}」"))
        })
        .transpose()
}

fn type_label(txn_type: &str) -> &'static str {
    if txn_type == "income" { "收入" } else { "支出" }
}

fn gift_label(gift_type: &str) -> &'static str {
    if gift_type == "give" { "送出" } else { "收到" }
}

fn money(d: Decimal) -> String {
    format!("{d:.2}")
}

fn join_note(first: Option<&str>, second: Option<&str>) -> Option<String> {
    let parts: Vec<&str> = [first, second]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    match parts.as_slice() {
        [] => None,
        [one] => Some(one.to_string()),
        [a, b] if b.contains(a) => Some(b.to_string()),
        _ => Some(parts.join(" · ")),
    }
}

fn db_err(e: impl std::fmt::Display) -> String {
    format!("数据库操作失败: {e}")
}

// ── Category resolution ──────────────────────────────────────────────

/// The family's visible category tree, loaded once per request.
pub struct CategoryTree {
    categories: Vec<Category>,
    subcategories: Vec<Subcategory>,
}

impl CategoryTree {
    pub async fn load(pool: &PgPool, family_id: Uuid) -> Result<Self, AppError> {
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
        Ok(Self { categories, subcategories })
    }

    /// "- 分类 (type)\n  - 子分类" listing for the system prompt.
    pub fn prompt_listing(&self) -> String {
        let mut out = String::new();
        for cat in &self.categories {
            out.push_str(&format!("- {} ({})\n", cat.name, cat.r#type));
            for sub in self.subcategories.iter().filter(|s| s.category_id == cat.id) {
                out.push_str(&format!("  - {}\n", sub.name));
            }
        }
        out.trim_end().to_string()
    }

    fn category(&self, id: Uuid) -> Option<&Category> {
        self.categories.iter().find(|c| c.id == id)
    }

    fn subcategory(&self, id: Uuid) -> Option<&Subcategory> {
        self.subcategories.iter().find(|s| s.id == id)
    }

    fn path(&self, category_id: Uuid, subcategory_id: Option<Uuid>) -> String {
        let cat = self.category(category_id).map_or("未知分类", |c| c.name.as_str());
        match subcategory_id.and_then(|id| self.subcategory(id)) {
            Some(sub) => format!("{cat} > {}", sub.name),
            None => cat.to_string(),
        }
    }

    fn names_of_type(&self, txn_type: &str) -> String {
        self.categories
            .iter()
            .filter(|c| c.r#type == txn_type)
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>()
            .join("、")
    }

    /// The only subcategory with this name among categories of `txn_type`.
    fn unique_sub(&self, name: &str, txn_type: &str) -> Option<&Subcategory> {
        let mut hits = self.subcategories.iter().filter(|s| {
            s.name == name && self.category(s.category_id).is_some_and(|c| c.r#type == txn_type)
        });
        let first = hits.next()?;
        hits.next().is_none().then_some(first)
    }

    /// Resolve model-chosen names to a category (and optional subcategory) of
    /// `txn_type`. Self-heals the common mistakes: a subcategory name given as
    /// the category, or the right subcategory under the wrong parent.
    fn resolve(
        &self,
        txn_type: &str,
        category_name: &str,
        sub_name: Option<&str>,
    ) -> Result<(&Category, Option<&Subcategory>), String> {
        let Some(category) = self
            .categories
            .iter()
            .find(|c| c.name == category_name && c.r#type == txn_type)
        else {
            if let Some(other) = self.categories.iter().find(|c| c.name == category_name) {
                return Err(format!(
                    "分类「{}」是{}分类，与 type={} 不一致。可用的{}分类：{}",
                    other.name,
                    type_label(&other.r#type),
                    txn_type,
                    type_label(txn_type),
                    self.names_of_type(txn_type),
                ));
            }
            if let Some(sub) = self.unique_sub(category_name, txn_type) {
                if let Some(parent) = self.category(sub.category_id) {
                    return Ok((parent, Some(sub)));
                }
            }
            return Err(format!(
                "找不到分类「{}」。可用的{}分类：{}",
                category_name,
                type_label(txn_type),
                self.names_of_type(txn_type),
            ));
        };

        let Some(sub_name) = sub_name else {
            return Ok((category, None));
        };
        if let Some(sub) = self
            .subcategories
            .iter()
            .find(|s| s.name == sub_name && s.category_id == category.id)
        {
            return Ok((category, Some(sub)));
        }
        if let Some(sub) = self.unique_sub(sub_name, txn_type) {
            if let Some(parent) = self.category(sub.category_id) {
                tracing::info!(
                    chosen = %category.name,
                    corrected = %parent.name,
                    subcategory = %sub_name,
                    "AI: corrected parent category from subcategory",
                );
                return Ok((parent, Some(sub)));
            }
        }
        // Unknown or ambiguous subcategory (e.g. 其他): keep the category only.
        Ok((category, None))
    }

    /// Query filter for a name that may be a category or a subcategory.
    fn filter_for(&self, name: &str, txn_type: Option<&str>) -> Option<(Option<Uuid>, Option<Uuid>)> {
        let type_ok = |t: &str| txn_type.is_none_or(|want| want == t);
        if let Some(cat) = self
            .categories
            .iter()
            .find(|c| c.name == name && type_ok(&c.r#type))
            .or_else(|| self.categories.iter().find(|c| c.name == name))
        {
            return Some((Some(cat.id), None));
        }
        self.subcategories
            .iter()
            .find(|s| {
                s.name == name && self.category(s.category_id).is_some_and(|c| type_ok(&c.r#type))
            })
            .map(|s| (None, Some(s.id)))
    }
}

// ── Transactions ─────────────────────────────────────────────────────

async fn create_transaction(ctx: &ToolContext, args: &Value) -> Result<ToolOutput, String> {
    let txn_type = txn_type(arg_str(args, "type").ok_or("缺少收支类型 type")?)?;
    let amount = arg_amount(args, "amount")?.ok_or("缺少金额 amount")?;
    let category_name = arg_str(args, "category_name").ok_or("缺少分类 category_name")?;
    let date = arg_date(args, "date")?.unwrap_or_else(|| ctx.now.date_naive());
    let time = arg_time(args, "time").unwrap_or_else(|| ctx.now.time());
    let currency = arg_str(args, "currency").map_or_else(|| "CNY".to_string(), str::to_uppercase);
    let note = arg_str(args, "note").map(String::from);
    let members = arg_list(args, "members").unwrap_or_default();

    let tree = CategoryTree::load(&ctx.pool, ctx.family_id).await.map_err(db_err)?;
    let (category, sub) = tree.resolve(txn_type, category_name, arg_str(args, "subcategory_name"))?;

    let txn = transaction::create_transaction(
        &ctx.pool,
        ctx.user_id,
        ctx.family_id,
        CreateTransactionRequest {
            category_id: category.id,
            subcategory_id: sub.map(|s| s.id),
            r#type: txn_type.to_string(),
            amount,
            currency: currency.clone(),
            date,
            time,
            location: None,
            note: note.clone(),
            members: (!members.is_empty()).then(|| members.clone()),
        },
    )
    .await
    .map_err(|e| format!("创建交易失败: {e}"))?;
    tracing::info!(txn_id = %txn.id, "AI: transaction created");

    let mut lines = vec![
        "✅ 记账成功！".to_string(),
        format!("{} {} {}", type_label(txn_type), money(amount), currency),
        format!("分类: {}", tree.path(category.id, sub.map(|s| s.id))),
        format!("日期: {} {}", date, time.format("%H:%M")),
    ];
    if !members.is_empty() {
        lines.push(format!("成员: {}", members.join("、")));
    }
    if let Some(n) = &note {
        lines.push(format!("备注: {n}"));
    }
    Ok(ToolOutput::with_id(format!("\n\n{}", lines.join("\n")), txn.id))
}

const TXN_FILTER: &str = "t.family_id = $1
    AND t.date >= $2 AND t.date <= $3
    AND ($4::uuid IS NULL OR t.category_id = $4)
    AND ($5::uuid IS NULL OR t.subcategory_id = $5)
    AND ($6::text IS NULL OR t.type = $6)
    AND ($7::text IS NULL OR EXISTS (
         SELECT 1 FROM transaction_members tm
         WHERE tm.transaction_id = t.id AND tm.member_name = $7))
    AND ($8::text IS NULL
         OR t.note ILIKE '%' || $8 || '%'
         OR t.location ILIKE '%' || $8 || '%'
         OR EXISTS (
            SELECT 1 FROM transaction_members tm
            WHERE tm.transaction_id = t.id AND tm.member_name ILIKE '%' || $8 || '%'))";

async fn member_names(pool: &PgPool, ids: &[Uuid]) -> Result<HashMap<Uuid, String>, String> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(Uuid, Option<String>)> = sqlx::query_as(
        "SELECT transaction_id, string_agg(member_name, '、' ORDER BY member_name)
         FROM transaction_members
         WHERE transaction_id = ANY($1)
         GROUP BY transaction_id",
    )
    .bind(ids)
    .fetch_all(pool)
    .await
    .map_err(db_err)?;
    Ok(rows.into_iter().filter_map(|(id, names)| names.map(|n| (id, n))).collect())
}

async fn query_transactions(ctx: &ToolContext, args: &Value) -> Result<ToolOutput, String> {
    let start = arg_date(args, "start_date")?.ok_or("缺少起始日期 start_date")?;
    let end = arg_date(args, "end_date")?.ok_or("缺少结束日期 end_date")?;
    let (start, end) = if start <= end { (start, end) } else { (end, start) };
    let type_filter = arg_str(args, "type").map(txn_type).transpose()?;
    let member = arg_str(args, "member_name");
    let keyword = arg_str(args, "keyword");

    let tree = CategoryTree::load(&ctx.pool, ctx.family_id).await.map_err(db_err)?;
    let (category_id, subcategory_id) = match arg_str(args, "category_name") {
        None => (None, None),
        Some(name) => tree.filter_for(name, type_filter).ok_or_else(|| {
            format!(
                "找不到分类「{name}」。支出分类：{}；收入分类：{}",
                tree.names_of_type("expense"),
                tree.names_of_type("income"),
            )
        })?,
    };

    let sort_by = arg_str(args, "sort_by").unwrap_or("date_desc");
    let limit = arg_i64(args, "limit").unwrap_or(100).clamp(1, 200);
    // Chosen from a fixed allow-list, never from model input.
    let order_clause = if sort_by == "amount_desc" {
        "ORDER BY t.amount DESC, t.date DESC, t.id"
    } else {
        "ORDER BY t.date DESC, t.time DESC, t.id"
    };

    // Totals cover the full filtered range, independent of the row limit.
    let (total_count, total_income, total_expense): (i64, Decimal, Decimal) = sqlx::query_as(&format!(
        "SELECT COUNT(*)::bigint,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0),
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)
         FROM transactions t
         WHERE {TXN_FILTER}"
    ))
    .bind(ctx.family_id)
    .bind(start)
    .bind(end)
    .bind(category_id)
    .bind(subcategory_id)
    .bind(type_filter)
    .bind(member)
    .bind(keyword)
    .fetch_one(&ctx.pool)
    .await
    .map_err(db_err)?;

    let rows = sqlx::query_as::<_, Transaction>(&format!(
        "SELECT t.* FROM transactions t WHERE {TXN_FILTER} {order_clause} LIMIT $9"
    ))
    .bind(ctx.family_id)
    .bind(start)
    .bind(end)
    .bind(category_id)
    .bind(subcategory_id)
    .bind(type_filter)
    .bind(member)
    .bind(keyword)
    .bind(limit)
    .fetch_all(&ctx.pool)
    .await
    .map_err(db_err)?;

    let ids: Vec<Uuid> = rows.iter().map(|t| t.id).collect();
    let members = member_names(&ctx.pool, &ids).await?;

    let lines: Vec<String> = rows
        .iter()
        .map(|t| {
            let mut parts = vec![
                format!("[{}] {} {}", t.id, t.date, t.time.format("%H:%M")),
                format!(
                    "{}{} {}",
                    if t.r#type == "income" { "+" } else { "-" },
                    money(t.amount),
                    t.currency
                ),
                tree.path(t.category_id, t.subcategory_id),
            ];
            if let Some(m) = members.get(&t.id) {
                parts.push(format!("人员: {m}"));
            }
            if let Some(n) = t.note.as_deref().filter(|n| !n.is_empty()) {
                parts.push(n.to_string());
            }
            parts.join(" | ")
        })
        .collect();

    let sort_label = if sort_by == "amount_desc" { "按金额从大到小" } else { "按日期倒序" };
    let truncated = if total_count > rows.len() as i64 {
        format!(
            "\n\n（该范围共 {} 条，以上仅{}返回前 {} 条。完整统计请用 get_statistics，或缩小范围。）",
            total_count,
            sort_label,
            rows.len()
        )
    } else {
        String::new()
    };

    Ok(ToolOutput::new(format!(
        "查询结果（{start} 至 {end}，{sort_label}）:\n该范围共 {total_count} 条，本次返回 {} 条\n区间总收入: {} CNY\n区间总支出: {} CNY\n净额: {} CNY\n\n明细:\n{}{truncated}",
        rows.len(),
        money(total_income),
        money(total_expense),
        money(total_income - total_expense),
        if lines.is_empty() { "无记录".to_string() } else { lines.join("\n") },
    )))
}

async fn update_transaction(ctx: &ToolContext, args: &Value) -> Result<ToolOutput, String> {
    let txn_id = arg_uuid(args, "transaction_id")?;
    let existing = transaction::get_transaction(&ctx.pool, ctx.family_id, txn_id)
        .await
        .map_err(|_| format!("找不到账单 {txn_id}，请先用 query_transactions 查询"))?;
    let current_members: Vec<String> = transaction::get_transaction_members(&ctx.pool, txn_id)
        .await
        .map_err(db_err)?
        .into_iter()
        .map(|m| m.member_name)
        .collect();
    let tree = CategoryTree::load(&ctx.pool, ctx.family_id).await.map_err(db_err)?;

    let new_type = match arg_str(args, "type") {
        Some(t) => txn_type(t)?.to_string(),
        None => existing.r#type.clone(),
    };
    let type_changed = new_type != existing.r#type;
    let cat_arg = arg_str(args, "category_name");
    let sub_arg = arg_str(args, "subcategory_name");

    let (category_id, subcategory_id) = if cat_arg.is_some() || sub_arg.is_some() || type_changed {
        let cat_name = match cat_arg {
            Some(name) => name.to_string(),
            None if type_changed => {
                return Err("修改收支类型时请同时指定新的分类 category_name".to_string())
            }
            None => tree
                .category(existing.category_id)
                .map(|c| c.name.clone())
                .ok_or("原分类已不存在，请指定 category_name")?,
        };
        let (cat, sub) = tree.resolve(&new_type, &cat_name, sub_arg)?;
        let sub_id = match sub {
            Some(s) => Some(s.id),
            // Keep the old subcategory only while it still belongs to the category.
            None if sub_arg.is_none() && cat.id == existing.category_id => existing.subcategory_id,
            None => None,
        };
        (cat.id, sub_id)
    } else {
        (existing.category_id, existing.subcategory_id)
    };

    let amount = arg_amount(args, "amount")?.unwrap_or(existing.amount);
    let date = arg_date(args, "date")?.unwrap_or(existing.date);
    let time = arg_time(args, "time").unwrap_or(existing.time);
    let note = match args.get("note") {
        Some(Value::String(s)) => Some(s.trim().to_string()).filter(|s| !s.is_empty()),
        _ => existing.note.clone(),
    };
    let members = arg_list(args, "members").unwrap_or_else(|| current_members.clone());

    transaction::update_transaction(
        &ctx.pool,
        ctx.user_id,
        ctx.family_id,
        txn_id,
        CreateTransactionRequest {
            category_id,
            subcategory_id,
            r#type: new_type.clone(),
            amount,
            currency: existing.currency.clone(),
            date,
            time,
            location: existing.location.clone(),
            note: note.clone(),
            members: Some(members.clone()),
        },
    )
    .await
    .map_err(|e| format!("更新交易失败: {e}"))?;

    let mut changes = Vec::new();
    if type_changed {
        changes.push(format!("类型 {} → {}", type_label(&existing.r#type), type_label(&new_type)));
    }
    if amount != existing.amount {
        changes.push(format!("金额 {} → {}", money(existing.amount), money(amount)));
    }
    if category_id != existing.category_id || subcategory_id != existing.subcategory_id {
        changes.push(format!(
            "分类 {} → {}",
            tree.path(existing.category_id, existing.subcategory_id),
            tree.path(category_id, subcategory_id)
        ));
    }
    if date != existing.date {
        changes.push(format!("日期 {} → {}", existing.date, date));
    }
    if time != existing.time {
        changes.push(format!("时间 → {}", time.format("%H:%M")));
    }
    if note != existing.note {
        changes.push(format!("备注 → {}", note.as_deref().unwrap_or("（清空）")));
    }
    if members != current_members {
        changes.push(format!(
            "人员 → {}",
            if members.is_empty() { "（清空）".to_string() } else { members.join("、") }
        ));
    }
    let desc = if changes.is_empty() { "无变化".to_string() } else { changes.join("；") };
    Ok(ToolOutput::with_id(format!("\n\n✅ 已更新交易记录：{desc}"), txn_id))
}

async fn delete_transaction(ctx: &ToolContext, args: &Value) -> Result<ToolOutput, String> {
    let txn_id = arg_uuid(args, "transaction_id")?;
    let existing = transaction::get_transaction(&ctx.pool, ctx.family_id, txn_id)
        .await
        .map_err(|_| format!("找不到账单 {txn_id}，请先用 query_transactions 查询"))?;
    let tree = CategoryTree::load(&ctx.pool, ctx.family_id).await.map_err(db_err)?;
    let linked_gift: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM social_gifts WHERE transaction_id = $1)")
            .bind(txn_id)
            .fetch_one(&ctx.pool)
            .await
            .map_err(db_err)?;

    transaction::delete_transaction(&ctx.pool, ctx.family_id, txn_id)
        .await
        .map_err(|e| format!("删除交易失败: {e}"))?;

    let mut text = format!(
        "\n\n✅ 已成功删除交易记录\n{} {} {} {} | {}",
        existing.date,
        type_label(&existing.r#type),
        money(existing.amount),
        existing.currency,
        tree.path(existing.category_id, existing.subcategory_id),
    );
    if let Some(n) = existing.note.as_deref().filter(|n| !n.is_empty()) {
        text.push_str(&format!(" | {n}"));
    }
    if linked_gift {
        text.push_str("\n（关联的人情记录已一并删除）");
    }
    Ok(ToolOutput::new(text))
}

// ── Statistics ───────────────────────────────────────────────────────

async fn get_statistics(ctx: &ToolContext, args: &Value) -> Result<ToolOutput, String> {
    let stat_type = arg_str(args, "stat_type").ok_or("缺少 stat_type")?;
    let year = arg_i64(args, "year").map_or_else(|| ctx.now.year(), |y| y as i32);
    let month = arg_i64(args, "month")
        .filter(|m| (1..=12).contains(m))
        .map(|m| m as u32);
    let kind = arg_str(args, "type").map(txn_type).transpose()?.unwrap_or("expense");
    let period = month.map_or_else(|| format!("{year}年"), |m| format!("{year}年{m}月"));
    let (pool, family_id) = (&ctx.pool, ctx.family_id);

    let text = match stat_type {
        "monthly_trend" => {
            let data = stats::monthly_trend(pool, family_id, year).await.map_err(db_err)?;
            if data.is_empty() {
                return Ok(ToolOutput::new(format!("{year}年暂无收支记录")));
            }
            let mut lines = vec![format!("{year}年月度收支趋势：")];
            for row in &data {
                lines.push(format!(
                    "{}月: 收入 {} / 支出 {} / 结余 {}",
                    row.month,
                    money(row.income),
                    money(row.expense),
                    money(row.income - row.expense),
                ));
            }
            let income: Decimal = data.iter().map(|r| r.income).sum();
            let expense: Decimal = data.iter().map(|r| r.expense).sum();
            lines.push(format!(
                "\n年度合计: 收入 {} / 支出 {} / 结余 {}",
                money(income),
                money(expense),
                money(income - expense)
            ));
            lines.join("\n")
        }
        "category_breakdown" => {
            let data = stats::category_breakdown(pool, family_id, year, month, Some(kind))
                .await
                .map_err(db_err)?;
            if data.is_empty() {
                return Ok(ToolOutput::new(format!("{period}暂无{}数据", type_label(kind))));
            }
            let total: Decimal = data.iter().map(|r| r.total).sum();
            let mut lines = vec![format!("{period} {}分类占比（合计 {}）：", type_label(kind), money(total))];
            for row in &data {
                lines.push(format!(
                    "{} {}: {} ({:.1}%)",
                    row.icon,
                    row.category_name,
                    money(row.total),
                    row.percentage
                ));
            }
            lines.join("\n")
        }
        "subcategory_breakdown" => {
            let only = arg_str(args, "category_name");
            let data: Vec<_> = stats::subcategory_breakdown(pool, family_id, year, month, Some(kind))
                .await
                .map_err(db_err)?
                .into_iter()
                .filter(|r| only.is_none_or(|c| r.category_name == c))
                .collect();
            if data.is_empty() {
                return Ok(ToolOutput::new(format!("{period}暂无{}数据", type_label(kind))));
            }
            let total: Decimal = data.iter().map(|r| r.total).sum();
            let mut lines = vec![format!("{period} {}子分类明细（合计 {}）：", type_label(kind), money(total))];
            for row in &data {
                let pct = if total.is_zero() {
                    Decimal::ZERO
                } else {
                    (row.total * Decimal::from(100) / total).round_dp(1)
                };
                lines.push(format!(
                    "{} > {}: {} ({}%)",
                    row.category_name,
                    row.subcategory_name.as_deref().unwrap_or("未分子类"),
                    money(row.total),
                    pct
                ));
            }
            lines.join("\n")
        }
        "member_breakdown" => {
            let data = stats::member_breakdown(pool, family_id, year, month, Some(kind))
                .await
                .map_err(db_err)?;
            if data.is_empty() {
                return Ok(ToolOutput::new(format!("{period}暂无人员{}数据", type_label(kind))));
            }
            let mut lines = vec![format!("{period} 人员{}分摊：", type_label(kind))];
            for row in &data {
                lines.push(format!("{}: {}", row.member_name, money(row.total)));
            }
            lines.join("\n")
        }
        other => return Err(format!("不支持的统计类型: {other}")),
    };
    Ok(ToolOutput::new(text))
}

// ── 人情往来 ──────────────────────────────────────────────────────────

fn gift_summary(title: &str, gift: &SocialGift, ledger: Option<&LedgerTarget>) -> String {
    let mut lines = vec![
        title.to_string(),
        format!(
            "{} {} {} {}",
            gift_label(&gift.r#type),
            gift.person_name,
            money(gift.amount),
            gift.currency
        ),
        match &gift.relation {
            Some(r) => format!("事由: {}（{}）", gift.occasion, r),
            None => format!("事由: {}", gift.occasion),
        },
        format!("日期: {}", gift.date),
    ];
    if let Some(n) = gift.note.as_deref().filter(|n| !n.is_empty()) {
        lines.push(format!("备注: {n}"));
    }
    match (ledger, gift.transaction_id) {
        (Some(t), _) => lines.push(format!(
            "已记账: {}{}（人员: {}）",
            t.category_name,
            t.subcategory_name.as_deref().map(|s| format!(" > {s}")).unwrap_or_default(),
            gift.person_name
        )),
        (None, Some(_)) => lines.push("对应账单已同步".to_string()),
        (None, None) => lines.push("⚠️ 未找到人情分类，仅登记到人情簿，未生成账单".to_string()),
    }
    format!("\n\n{}", lines.join("\n"))
}

async fn create_social_gift(ctx: &ToolContext, args: &Value) -> Result<ToolOutput, String> {
    let gift_type = gift_type_arg(args)?.ok_or("缺少 type：give（送出）或 receive（收到）")?;
    let person_name = arg_str(args, "person_name").ok_or("缺少对方姓名 person_name")?;
    let amount = arg_amount(args, "amount")?.ok_or("缺少金额 amount")?;
    let date = arg_date(args, "date")?.unwrap_or_else(|| ctx.now.date_naive());
    let time = arg_time(args, "time").unwrap_or_else(|| ctx.now.time());
    let (occasion, occasion_extra) = social_gift::normalize_occasion(arg_str(args, "occasion"));
    let relation = arg_str(args, "relation").map(social_gift::normalize_relation);
    let note = join_note(occasion_extra.as_deref(), arg_str(args, "note"));

    let (gift, ledger) = social_gift::create_social_gift(
        &ctx.pool,
        ctx.user_id,
        ctx.family_id,
        CreateSocialGiftRequest {
            r#type: gift_type.to_string(),
            person_name: person_name.to_string(),
            relation,
            occasion,
            amount,
            currency: "CNY".to_string(),
            date,
            note,
            kind: kind_arg(args),
        },
        time,
    )
    .await
    .map_err(|e| format!("记录人情往来失败: {e}"))?;
    tracing::info!(gift_id = %gift.id, txn_id = ?gift.transaction_id, "AI: social gift booked");

    Ok(ToolOutput::with_id(
        gift_summary("✅ 人情记录成功！", &gift, ledger.as_ref()),
        gift.transaction_id.unwrap_or(gift.id),
    ))
}

/// A 人情簿 record addressed either by its own id or by its ledger entry's id.
async fn find_gift(ctx: &ToolContext, id: Uuid) -> Result<Option<SocialGift>, String> {
    sqlx::query_as::<_, SocialGift>(
        "SELECT * FROM social_gifts WHERE family_id = $1 AND (id = $2 OR transaction_id = $2) LIMIT 1",
    )
    .bind(ctx.family_id)
    .bind(id)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(db_err)
}

/// A transaction filed under a 人情 category.
async fn find_gift_ledger_entry(ctx: &ToolContext, id: Uuid) -> Result<Option<Transaction>, String> {
    sqlx::query_as::<_, Transaction>(
        "SELECT t.* FROM transactions t
         JOIN categories c ON c.id = t.category_id
         WHERE t.id = $1 AND t.family_id = $2 AND c.name LIKE '%人情%'",
    )
    .bind(id)
    .bind(ctx.family_id)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(db_err)
}

fn gift_not_found(id: Uuid) -> String {
    format!("找不到人情记录 {id}，请先用 query_social_gifts 查询获取 ID")
}

async fn update_social_gift(ctx: &ToolContext, args: &Value) -> Result<ToolOutput, String> {
    let id = arg_uuid(args, "record_id")?;
    let kind = kind_arg(args);
    let new_note = match args.get("note") {
        Some(Value::String(s)) => Some(Some(s.trim().to_string()).filter(|s| !s.is_empty())),
        _ => None,
    };

    if let Some(gift) = find_gift(ctx, id).await? {
        let (occasion, extra) = match arg_str(args, "occasion") {
            Some(o) => social_gift::normalize_occasion(Some(o)),
            None => (gift.occasion.clone(), None),
        };
        let note = join_note(
            extra.as_deref(),
            new_note.clone().unwrap_or_else(|| gift.note.clone()).as_deref(),
        );
        let updated = social_gift::update_social_gift(
            &ctx.pool,
            ctx.family_id,
            gift.id,
            CreateSocialGiftRequest {
                r#type: gift_type_arg(args)?.map_or_else(|| gift.r#type.clone(), String::from),
                person_name: arg_str(args, "person_name").map_or_else(|| gift.person_name.clone(), String::from),
                relation: arg_str(args, "relation")
                    .map(social_gift::normalize_relation)
                    .or_else(|| gift.relation.clone()),
                occasion,
                amount: arg_amount(args, "amount")?.unwrap_or(gift.amount),
                currency: gift.currency.clone(),
                date: arg_date(args, "date")?.unwrap_or(gift.date),
                note,
                kind: kind.clone(),
            },
        )
        .await
        .map_err(|e| format!("更新人情记录失败: {e}"))?;
        return Ok(ToolOutput::with_id(
            gift_summary("✅ 人情记录已更新", &updated, None),
            updated.transaction_id.unwrap_or(updated.id),
        ));
    }

    // A 人情 ledger entry with no 人情簿 record (e.g. imported from CSV).
    let txn = find_gift_ledger_entry(ctx, id).await?.ok_or_else(|| gift_not_found(id))?;
    let old_type = if txn.r#type == "income" { "receive" } else { "give" };
    let new_type = gift_type_arg(args)?.unwrap_or(old_type);
    let (category_id, subcategory_id) = if new_type != old_type || kind.is_some() {
        let target = social_gift::ledger_target(
            &ctx.pool,
            ctx.family_id,
            new_type,
            social_gift::ledger_subcategory(new_type, kind.as_deref()),
        )
        .await
        .map_err(db_err)?
        .ok_or("找不到对应的人情分类")?;
        (target.category_id, target.subcategory_id)
    } else {
        (txn.category_id, txn.subcategory_id)
    };
    let members = match arg_str(args, "person_name") {
        Some(p) => vec![p.to_string()],
        None => transaction::get_transaction_members(&ctx.pool, txn.id)
            .await
            .map_err(db_err)?
            .into_iter()
            .map(|m| m.member_name)
            .collect(),
    };
    // A bare ledger entry has no occasion column; fold a new one into the note.
    let note = join_note(
        arg_str(args, "occasion"),
        new_note.unwrap_or_else(|| txn.note.clone()).as_deref(),
    );
    let amount = arg_amount(args, "amount")?.unwrap_or(txn.amount);
    let date = arg_date(args, "date")?.unwrap_or(txn.date);

    transaction::update_transaction(
        &ctx.pool,
        ctx.user_id,
        ctx.family_id,
        txn.id,
        CreateTransactionRequest {
            category_id,
            subcategory_id,
            r#type: social_gift::ledger_type(new_type).to_string(),
            amount,
            currency: txn.currency.clone(),
            date,
            time: txn.time,
            location: txn.location.clone(),
            note: note.clone(),
            members: Some(members.clone()),
        },
    )
    .await
    .map_err(|e| format!("更新人情记录失败: {e}"))?;

    let mut lines = vec![
        "✅ 人情记录已更新".to_string(),
        format!("{} {} {} {}", gift_label(new_type), members.join("、"), money(amount), txn.currency),
        format!("日期: {date}"),
    ];
    if let Some(n) = &note {
        lines.push(format!("备注: {n}"));
    }
    Ok(ToolOutput::with_id(format!("\n\n{}", lines.join("\n")), txn.id))
}

async fn delete_social_gift(ctx: &ToolContext, args: &Value) -> Result<ToolOutput, String> {
    let id = arg_uuid(args, "record_id")?;

    if let Some(gift) = find_gift(ctx, id).await? {
        social_gift::delete_social_gift(&ctx.pool, ctx.family_id, gift.id)
            .await
            .map_err(|e| format!("删除人情记录失败: {e}"))?;
        let mut text = format!(
            "\n\n✅ 已删除人情记录\n{} {} {} {} | {} | {}",
            gift_label(&gift.r#type),
            gift.person_name,
            money(gift.amount),
            gift.currency,
            gift.occasion,
            gift.date
        );
        if gift.transaction_id.is_some() {
            text.push_str("\n（对应账单已一并删除）");
        }
        return Ok(ToolOutput::new(text));
    }

    let txn = find_gift_ledger_entry(ctx, id).await?.ok_or_else(|| gift_not_found(id))?;
    let members = member_names(&ctx.pool, &[txn.id]).await?;
    transaction::delete_transaction(&ctx.pool, ctx.family_id, txn.id)
        .await
        .map_err(|e| format!("删除人情记录失败: {e}"))?;
    Ok(ToolOutput::new(format!(
        "\n\n✅ 已删除人情记录\n{} {} {} {} | {}",
        gift_label(if txn.r#type == "income" { "receive" } else { "give" }),
        members.get(&txn.id).map_or("", String::as_str),
        money(txn.amount),
        txn.currency,
        txn.date
    )))
}

#[derive(sqlx::FromRow)]
struct GiftLedgerRow {
    id: Uuid,
    date: NaiveDate,
    r#type: String,
    amount: Decimal,
    currency: String,
    note: Option<String>,
    subcategory_name: Option<String>,
    members: String,
    person_share: Decimal,
    relation: Option<String>,
    occasion: Option<String>,
}

struct GiftEntry {
    id: Uuid,
    date: NaiveDate,
    give: bool,
    amount: Decimal,
    currency: String,
    who: String,
    detail: String,
}

/// Unified 人情 view: every transaction in a 人情 category (the source of the
/// 人情 statistics, including CSV imports) plus 人情簿 records that have no
/// ledger entry. Linked records appear once, under their transaction id.
async fn query_social_gifts(ctx: &ToolContext, args: &Value) -> Result<ToolOutput, String> {
    let (start, end) = match (arg_date(args, "start_date")?, arg_date(args, "end_date")?) {
        (Some(s), Some(e)) if s > e => (Some(e), Some(s)),
        range => range,
    };
    let gift_type = gift_type_arg(args)?;
    let person = arg_str(args, "person_name");

    let ledger: Vec<GiftLedgerRow> = sqlx::query_as(
        "SELECT t.id, t.date, t.type, t.amount, t.currency, t.note,
                s.name AS subcategory_name,
                COALESCE(string_agg(tm.member_name, '、' ORDER BY tm.member_name), '') AS members,
                COALESCE(SUM(tm.share_amount) FILTER (WHERE tm.member_name ILIKE '%' || $5 || '%'), 0) AS person_share,
                g.relation, g.occasion
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
         LEFT JOIN subcategories s ON s.id = t.subcategory_id
         LEFT JOIN transaction_members tm ON tm.transaction_id = t.id
         LEFT JOIN social_gifts g ON g.transaction_id = t.id
         WHERE t.family_id = $1
           AND c.name LIKE '%人情%'
           AND ($2::date IS NULL OR t.date >= $2)
           AND ($3::date IS NULL OR t.date <= $3)
           AND ($4::text IS NULL OR t.type = $4)
         GROUP BY t.id, s.name, g.relation, g.occasion
         HAVING $5::text IS NULL OR bool_or(tm.member_name ILIKE '%' || $5 || '%')
         ORDER BY t.date DESC, t.time DESC
         LIMIT $6",
    )
    .bind(ctx.family_id)
    .bind(start)
    .bind(end)
    .bind(gift_type.map(social_gift::ledger_type))
    .bind(person)
    .bind(QUERY_ROW_CAP)
    .fetch_all(&ctx.pool)
    .await
    .map_err(db_err)?;

    let standalone = sqlx::query_as::<_, SocialGift>(
        "SELECT * FROM social_gifts
         WHERE family_id = $1
           AND transaction_id IS NULL
           AND ($2::date IS NULL OR date >= $2)
           AND ($3::date IS NULL OR date <= $3)
           AND ($4::text IS NULL OR type = $4)
           AND ($5::text IS NULL OR person_name ILIKE '%' || $5 || '%')
         ORDER BY date DESC
         LIMIT $6",
    )
    .bind(ctx.family_id)
    .bind(start)
    .bind(end)
    .bind(gift_type)
    .bind(person)
    .bind(QUERY_ROW_CAP)
    .fetch_all(&ctx.pool)
    .await
    .map_err(db_err)?;

    let truncated = ledger.len() as i64 >= QUERY_ROW_CAP || standalone.len() as i64 >= QUERY_ROW_CAP;

    let mut entries: Vec<GiftEntry> = Vec::with_capacity(ledger.len() + standalone.len());
    for row in &ledger {
        let mut detail: Vec<String> = Vec::new();
        if let Some(o) = &row.occasion {
            detail.push(match &row.relation {
                Some(r) => format!("{o}（{r}）"),
                None => o.clone(),
            });
        }
        if let Some(s) = &row.subcategory_name {
            detail.push(s.clone());
        }
        if let Some(n) = row.note.as_deref().filter(|n| !n.is_empty()) {
            detail.push(n.to_string());
        }
        entries.push(GiftEntry {
            id: row.id,
            date: row.date,
            give: row.r#type == "expense",
            // With a person filter, count only that person's share of split entries.
            amount: if person.is_some() { row.person_share } else { row.amount },
            currency: row.currency.clone(),
            who: if row.members.is_empty() { "（未填人员）".to_string() } else { row.members.clone() },
            detail: detail.join(" | "),
        });
    }
    for g in &standalone {
        let mut detail = vec![match &g.relation {
            Some(r) => format!("{}（{}）", g.occasion, r),
            None => g.occasion.clone(),
        }];
        if let Some(n) = g.note.as_deref().filter(|n| !n.is_empty()) {
            detail.push(n.to_string());
        }
        detail.push("仅人情簿，未记账".to_string());
        entries.push(GiftEntry {
            id: g.id,
            date: g.date,
            give: g.r#type == "give",
            amount: g.amount,
            currency: g.currency.clone(),
            who: g.person_name.clone(),
            detail: detail.join(" | "),
        });
    }
    entries.sort_by_key(|e| std::cmp::Reverse(e.date));

    let given: Decimal = entries.iter().filter(|e| e.give).map(|e| e.amount).sum();
    let received: Decimal = entries.iter().filter(|e| !e.give).map(|e| e.amount).sum();

    let range_label = match (start, end) {
        (Some(s), Some(e)) => format!("{s} 至 {e}"),
        (Some(s), None) => format!("{s} 起"),
        (None, Some(e)) => format!("截至 {e}"),
        (None, None) => "全部时间".to_string(),
    };
    let mut filters = Vec::new();
    if let Some(p) = person {
        filters.push(format!("对方: {p}"));
    }
    if let Some(t) = gift_type {
        filters.push(gift_label(t).to_string());
    }
    let filter_label = if filters.is_empty() { String::new() } else { format!("，{}", filters.join("，")) };

    let mut out = format!(
        "人情往来查询（{range_label}{filter_label}）\n共 {} 笔｜送出合计 {}｜收到合计 {}｜净额（收到-送出）{}",
        entries.len(),
        money(given),
        money(received),
        money(received - given),
    );

    if person.is_none() && !entries.is_empty() {
        let per_person = per_person_totals(ctx, start, end, gift_type, &standalone).await?;
        if !per_person.is_empty() {
            out.push_str("\n\n按人汇总（送出 / 收到，前 15 位）:");
            for (name, (g, r)) in per_person.iter().take(15) {
                out.push_str(&format!("\n- {name}: 送出 {} / 收到 {}", money(*g), money(*r)));
            }
        }
    }

    out.push_str("\n\n明细（[ID] 用于 update_social_gift / delete_social_gift）:");
    if entries.is_empty() {
        out.push_str("\n无记录");
    }
    for e in &entries {
        out.push_str(&format!(
            "\n[{}] {} {}{} {} {}{}",
            e.id,
            e.date,
            if e.give { "送出→" } else { "收到←" },
            e.who,
            money(e.amount),
            e.currency,
            if e.detail.is_empty() { String::new() } else { format!(" | {}", e.detail) },
        ));
    }
    if truncated {
        out.push_str(&format!("\n\n（记录较多，仅返回最近 {QUERY_ROW_CAP} 条，可缩小时间范围或按人查询）"));
    }
    Ok(ToolOutput::new(out))
}

/// Given/received per counterpart, using member shares for split entries.
async fn per_person_totals(
    ctx: &ToolContext,
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
    gift_type: Option<&str>,
    standalone: &[SocialGift],
) -> Result<Vec<(String, (Decimal, Decimal))>, String> {
    let rows: Vec<(String, Decimal, Decimal)> = sqlx::query_as(
        "SELECT tm.member_name,
                COALESCE(SUM(tm.share_amount) FILTER (WHERE t.type = 'expense'), 0),
                COALESCE(SUM(tm.share_amount) FILTER (WHERE t.type = 'income'), 0)
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
         JOIN transaction_members tm ON tm.transaction_id = t.id
         WHERE t.family_id = $1
           AND c.name LIKE '%人情%'
           AND ($2::date IS NULL OR t.date >= $2)
           AND ($3::date IS NULL OR t.date <= $3)
           AND ($4::text IS NULL OR t.type = $4)
         GROUP BY tm.member_name",
    )
    .bind(ctx.family_id)
    .bind(start)
    .bind(end)
    .bind(gift_type.map(social_gift::ledger_type))
    .fetch_all(&ctx.pool)
    .await
    .map_err(db_err)?;

    let mut totals: BTreeMap<String, (Decimal, Decimal)> = BTreeMap::new();
    for (name, g, r) in rows {
        let e = totals.entry(name).or_default();
        e.0 += g;
        e.1 += r;
    }
    for gift in standalone {
        let e = totals.entry(gift.person_name.clone()).or_default();
        if gift.r#type == "give" {
            e.0 += gift.amount;
        } else {
            e.1 += gift.amount;
        }
    }
    let mut list: Vec<_> = totals.into_iter().collect();
    list.sort_by_key(|(_, (given, received))| std::cmp::Reverse(*given + *received));
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_loose_amounts() {
        let args = json!({ "a": 164.98, "b": "1,000元", "c": -50, "d": 0, "e": "" });
        assert_eq!(arg_amount(&args, "a").unwrap(), Some(Decimal::new(16498, 2)));
        assert_eq!(arg_amount(&args, "b").unwrap(), Some(Decimal::from(1000)));
        assert_eq!(arg_amount(&args, "c").unwrap(), Some(Decimal::from(50)));
        assert!(arg_amount(&args, "d").is_err());
        assert_eq!(arg_amount(&args, "e").unwrap(), None);
        assert_eq!(arg_amount(&args, "missing").unwrap(), None);
    }

    #[test]
    fn parses_loose_dates_and_lists() {
        let args = json!({ "a": "2026/9/1", "b": "2026-09-01T08:00:00", "c": "九月", "m": "黄丹丹、尤运鸿,黄丹丹" });
        let sept_first = NaiveDate::from_ymd_opt(2026, 9, 1);
        assert_eq!(arg_date(&args, "a").unwrap(), sept_first);
        assert_eq!(arg_date(&args, "b").unwrap(), sept_first);
        assert!(arg_date(&args, "c").is_err());
        assert_eq!(arg_list(&args, "m").unwrap(), vec!["黄丹丹", "尤运鸿"]);
    }

    #[test]
    fn accepts_double_encoded_arguments() {
        let args = parse_args("\"{\\\"type\\\":\\\"given\\\"}\"").unwrap();
        assert_eq!(gift_type_arg(&args).unwrap(), Some("give"));
        assert!(parse_args("[1]").is_err());
        assert_eq!(parse_args("  ").unwrap(), json!({}));
    }

    #[test]
    fn join_note_skips_duplicates() {
        assert_eq!(join_note(Some("见面礼"), Some("给燕大姐二宝")).as_deref(), Some("见面礼 · 给燕大姐二宝"));
        assert_eq!(join_note(Some("生日"), Some("牛牛生日红包")).as_deref(), Some("牛牛生日红包"));
        assert_eq!(join_note(None, Some("  ")), None);
    }
}
