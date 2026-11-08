use chrono::{NaiveTime, Utc};
use rust_decimal::Decimal;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    CreateSocialGiftRequest, CreateTransactionRequest, PaginatedResponse, SocialGift,
    SocialGiftFilter, Transaction,
};
use crate::services::transaction;

/// Occasions offered by the 人情往来 page (keep in sync with `SocialGiftsPage`).
pub const OCCASIONS: &[&str] = &[
    "婚礼", "生日", "满月", "乔迁", "升学", "节日", "丧事", "探病", "其他",
];
/// Relations offered by the 人情往来 page (keep in sync with `SocialGiftsPage`).
pub const RELATIONS: &[&str] = &["亲戚", "朋友", "同事", "同学", "邻居", "长辈", "晚辈", "其他"];
/// What was given, which decides the ledger subcategory.
pub const KINDS: &[&str] = &["红包", "礼金", "礼物"];

/// Map loose wording ("given", "送出", "收到", …) onto the stored `give` / `receive`.
pub fn normalize_gift_type(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "give" | "given" | "send" | "sent" | "out" | "expense" | "送" | "送出" | "给" | "随礼" => {
            Some("give")
        }
        "receive" | "received" | "in" | "income" | "收" | "收到" => Some("receive"),
        _ => None,
    }
}

/// Fold a free-form occasion onto `OCCASIONS`. Anything unrecognised becomes
/// 其他 and the original wording is returned so it can be kept in the note.
pub fn normalize_occasion(raw: Option<&str>) -> (String, Option<String>) {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return ("其他".to_string(), None);
    };
    if OCCASIONS.contains(&raw) {
        return (raw.to_string(), None);
    }
    const SYNONYMS: &[(&[&str], &str)] = &[
        (&["婚", "喜酒", "喜宴", "份子", "嫁", "娶"], "婚礼"),
        (&["生日", "寿", "周岁"], "生日"),
        (&["满月", "百天", "百日"], "满月"),
        (&["乔迁", "搬家", "新房", "新居", "入宅", "暖房"], "乔迁"),
        (&["升学", "考上", "录取", "谢师", "高考", "中考"], "升学"),
        (&["春节", "过年", "拜年", "压岁", "中秋", "端午", "元宵", "除夕", "节"], "节日"),
        (&["丧", "白事", "葬", "吊唁", "奔丧", "去世", "过世"], "丧事"),
        (&["探病", "看望", "生病", "住院", "手术", "慰问"], "探病"),
    ];
    for (keys, target) in SYNONYMS {
        if keys.iter().any(|k| raw.contains(k)) {
            return (target.to_string(), None);
        }
    }
    ("其他".to_string(), Some(raw.to_string()))
}

/// Fold a free-form relation (表哥, 领导, 闺蜜, …) onto `RELATIONS`.
pub fn normalize_relation(raw: &str) -> String {
    let raw = raw.trim();
    if RELATIONS.contains(&raw) {
        return raw.to_string();
    }
    const SYNONYMS: &[(&[&str], &str)] = &[
        (&["同事", "领导", "老板", "上司", "下属", "客户"], "同事"),
        (&["同学", "校友", "室友"], "同学"),
        (&["邻居", "街坊"], "邻居"),
        (&["朋友", "好友", "闺蜜", "兄弟", "哥们", "发小"], "朋友"),
        (&["爷", "奶", "外公", "外婆", "姥", "岳父", "岳母", "公公", "婆婆"], "长辈"),
        (&["表", "堂", "舅", "姑", "叔", "伯", "姨", "婶", "侄", "甥", "嫂", "亲戚"], "亲戚"),
    ];
    for (keys, target) in SYNONYMS {
        if keys.iter().any(|k| raw.contains(k)) {
            return target.to_string();
        }
    }
    "其他".to_string()
}

/// Ledger transaction type for a gift direction.
pub fn ledger_type(gift_type: &str) -> &'static str {
    if gift_type == "give" { "expense" } else { "income" }
}

/// Default ledger subcategory (from the seeded 人情往来 / 人情收入 trees).
pub fn ledger_subcategory(gift_type: &str, kind: Option<&str>) -> &'static str {
    let kind = kind.unwrap_or("");
    match gift_type {
        "give" if kind.contains("礼物") => "礼物",
        "give" => "红包礼金",
        _ if kind.contains("礼金") || kind.contains("礼物") => "收到礼金",
        _ => "收到红包",
    }
}

/// Ledger note for a booked gift, e.g. "婚礼红包" or "生日 · 黄丹丹买的补品".
fn ledger_note(occasion: &str, note: Option<&str>, kind: Option<&str>) -> Option<String> {
    let occasion = (occasion != "其他").then_some(occasion);
    match (occasion, note.map(str::trim).filter(|n| !n.is_empty())) {
        (Some(o), Some(n)) if n.contains(o) => Some(n.to_string()),
        (Some(o), Some(n)) => Some(format!("{o} · {n}")),
        (None, Some(n)) => Some(n.to_string()),
        (Some(o), None) => Some(format!("{o}{}", kind.unwrap_or(""))),
        (None, None) => kind.map(String::from),
    }
}

/// The 人情 category/subcategory a gift is booked under.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LedgerTarget {
    pub category_id: Uuid,
    pub category_name: String,
    pub subcategory_id: Option<Uuid>,
    pub subcategory_name: Option<String>,
}

/// Find the family's 人情 category for the gift direction (preferring the
/// seeded 人情往来 / 人情收入) and the named subcategory under it, if present.
pub async fn ledger_target<'e, E>(
    exec: E,
    family_id: Uuid,
    gift_type: &str,
    subcategory_name: &str,
) -> Result<Option<LedgerTarget>, AppError>
where
    E: sqlx::PgExecutor<'e>,
{
    let preferred = if gift_type == "give" { "人情往来" } else { "人情收入" };
    let target = sqlx::query_as::<_, LedgerTarget>(
        "SELECT c.id AS category_id, c.name AS category_name,
                s.id AS subcategory_id, s.name AS subcategory_name
         FROM categories c
         LEFT JOIN subcategories s ON s.category_id = c.id AND s.name = $3
         WHERE (c.user_id IS NULL OR c.family_id = $1)
           AND c.type = $2
           AND c.name LIKE '%人情%'
         ORDER BY (c.name = $4) DESC, c.sort_order
         LIMIT 1",
    )
    .bind(family_id)
    .bind(ledger_type(gift_type))
    .bind(subcategory_name)
    .bind(preferred)
    .fetch_optional(exec)
    .await?;
    Ok(target)
}

fn validate(req: &CreateSocialGiftRequest) -> Result<(), AppError> {
    if req.r#type != "give" && req.r#type != "receive" {
        return Err(AppError::Validation(
            "Type must be 'give' or 'receive'".to_string(),
        ));
    }
    if req.person_name.trim().is_empty() {
        return Err(AppError::Validation(
            "Person name cannot be empty".to_string(),
        ));
    }
    if req.occasion.trim().is_empty() {
        return Err(AppError::Validation("Occasion cannot be empty".to_string()));
    }
    if req.amount <= Decimal::ZERO {
        return Err(AppError::Validation("Amount must be positive".to_string()));
    }
    if req.kind.as_deref().is_some_and(|k| !KINDS.contains(&k)) {
        return Err(AppError::Validation(
            "Kind must be one of 红包 / 礼金 / 礼物".to_string(),
        ));
    }
    Ok(())
}

async fn insert_gift(
    conn: &mut PgConnection,
    user_id: Uuid,
    family_id: Uuid,
    req: &CreateSocialGiftRequest,
    transaction_id: Option<Uuid>,
) -> Result<SocialGift, AppError> {
    let gift = sqlx::query_as::<_, SocialGift>(
        "INSERT INTO social_gifts (id, user_id, family_id, type, person_name, relation, occasion, amount, currency, date, note, created_at, transaction_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(family_id)
    .bind(&req.r#type)
    .bind(req.person_name.trim())
    .bind(&req.relation)
    .bind(&req.occasion)
    .bind(req.amount)
    .bind(&req.currency)
    .bind(req.date)
    .bind(&req.note)
    .bind(Utc::now())
    .bind(transaction_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(gift)
}

/// Record a 人情 event as a ledger transaction (人情往来 / 人情收入, with the
/// counterpart as the transaction member — the shape the 人情 statistics read)
/// plus a linked social_gifts row, atomically. If the family has no 人情
/// category the gift is still recorded, just without a ledger entry.
pub async fn create_social_gift(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    req: CreateSocialGiftRequest,
    time: NaiveTime,
) -> Result<(SocialGift, Option<LedgerTarget>), AppError> {
    validate(&req)?;
    let kind = req.kind.as_deref();
    let mut tx = pool.begin().await?;

    let target = ledger_target(
        &mut *tx,
        family_id,
        &req.r#type,
        ledger_subcategory(&req.r#type, kind),
    )
    .await?;

    let transaction_id = match &target {
        Some(t) => {
            let txn = transaction::insert_transaction(
                &mut tx,
                user_id,
                family_id,
                &CreateTransactionRequest {
                    category_id: t.category_id,
                    subcategory_id: t.subcategory_id,
                    r#type: ledger_type(&req.r#type).to_string(),
                    amount: req.amount,
                    currency: req.currency.clone(),
                    date: req.date,
                    time,
                    location: None,
                    note: ledger_note(&req.occasion, req.note.as_deref(), kind),
                    members: Some(vec![req.person_name.trim().to_string()]),
                },
            )
            .await?;
            Some(txn.id)
        }
        None => None,
    };

    let gift = insert_gift(&mut tx, user_id, family_id, &req, transaction_id).await?;
    tx.commit().await?;
    Ok((gift, target))
}

pub async fn get_social_gift(
    pool: &PgPool,
    family_id: Uuid,
    gift_id: Uuid,
) -> Result<SocialGift, AppError> {
    let gift = sqlx::query_as::<_, SocialGift>(
        "SELECT * FROM social_gifts WHERE id = $1 AND family_id = $2",
    )
    .bind(gift_id)
    .bind(family_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Social gift not found".to_string()))?;
    Ok(gift)
}

pub async fn list_social_gifts(
    pool: &PgPool,
    family_id: Uuid,
    filter: SocialGiftFilter,
) -> Result<PaginatedResponse<SocialGift>, AppError> {
    let page = filter.page.unwrap_or(1).max(1);
    let per_page = filter.per_page.unwrap_or(20).min(100);
    let offset = ((page - 1) * per_page) as i64;

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM social_gifts
         WHERE family_id = $1
           AND ($2::text IS NULL OR type = $2)
           AND ($3::text IS NULL OR person_name ILIKE '%' || $3 || '%')
           AND ($4::int IS NULL OR EXTRACT(YEAR FROM date) = $4)
           AND ($5::date IS NULL OR date >= $5)
           AND ($6::date IS NULL OR date <= $6)",
    )
    .bind(family_id)
    .bind(&filter.r#type)
    .bind(&filter.person_name)
    .bind(filter.year)
    .bind(filter.start_date)
    .bind(filter.end_date)
    .fetch_one(pool)
    .await?;

    let gifts = sqlx::query_as::<_, SocialGift>(
        "SELECT * FROM social_gifts
         WHERE family_id = $1
           AND ($2::text IS NULL OR type = $2)
           AND ($3::text IS NULL OR person_name ILIKE '%' || $3 || '%')
           AND ($4::int IS NULL OR EXTRACT(YEAR FROM date) = $4)
           AND ($5::date IS NULL OR date >= $5)
           AND ($6::date IS NULL OR date <= $6)
         ORDER BY date DESC, created_at DESC
         LIMIT $7 OFFSET $8",
    )
    .bind(family_id)
    .bind(&filter.r#type)
    .bind(&filter.person_name)
    .bind(filter.year)
    .bind(filter.start_date)
    .bind(filter.end_date)
    .bind(per_page as i64)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(PaginatedResponse {
        data: gifts,
        total: total.0,
        page,
        per_page,
    })
}

/// Update a gift; if it is linked to a ledger entry, that transaction is kept in
/// sync (amount, date, direction, counterpart, note). `req.kind` re-picks the
/// ledger subcategory; `None` keeps the current one unless the direction changed.
pub async fn update_social_gift(
    pool: &PgPool,
    family_id: Uuid,
    gift_id: Uuid,
    req: CreateSocialGiftRequest,
) -> Result<SocialGift, AppError> {
    validate(&req)?;
    let mut tx = pool.begin().await?;

    let old = sqlx::query_as::<_, SocialGift>(
        "SELECT * FROM social_gifts WHERE id = $1 AND family_id = $2 FOR UPDATE",
    )
    .bind(gift_id)
    .bind(family_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Social gift not found".to_string()))?;

    let gift = sqlx::query_as::<_, SocialGift>(
        "UPDATE social_gifts
         SET type = $1, person_name = $2, relation = $3, occasion = $4,
             amount = $5, currency = $6, date = $7, note = $8
         WHERE id = $9 AND family_id = $10
         RETURNING *",
    )
    .bind(&req.r#type)
    .bind(req.person_name.trim())
    .bind(&req.relation)
    .bind(&req.occasion)
    .bind(req.amount)
    .bind(&req.currency)
    .bind(req.date)
    .bind(&req.note)
    .bind(gift_id)
    .bind(family_id)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(txn_id) = gift.transaction_id {
        sync_ledger(&mut tx, family_id, txn_id, &old, &gift, req.kind.as_deref()).await?;
    }

    tx.commit().await?;
    Ok(gift)
}

async fn sync_ledger(
    conn: &mut PgConnection,
    family_id: Uuid,
    txn_id: Uuid,
    old: &SocialGift,
    new: &SocialGift,
    kind: Option<&str>,
) -> Result<(), AppError> {
    let Some(existing) = sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions WHERE id = $1 AND family_id = $2",
    )
    .bind(txn_id)
    .bind(family_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(());
    };

    let (category_id, subcategory_id) = if old.r#type != new.r#type || kind.is_some() {
        let target = ledger_target(
            &mut *conn,
            family_id,
            &new.r#type,
            ledger_subcategory(&new.r#type, kind),
        )
        .await?
        .ok_or_else(|| {
            AppError::Validation("No 人情 category found for the ledger entry".to_string())
        })?;
        (target.category_id, target.subcategory_id)
    } else {
        (existing.category_id, existing.subcategory_id)
    };

    let note = if old.occasion != new.occasion || old.note != new.note || kind.is_some() {
        ledger_note(&new.occasion, new.note.as_deref(), kind)
    } else {
        existing.note.clone()
    };

    // Swap the counterpart in place; other members the user added stay.
    let current: Vec<String> = sqlx::query_scalar(
        "SELECT member_name FROM transaction_members WHERE transaction_id = $1 ORDER BY member_name",
    )
    .bind(txn_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut members: Vec<String> = current
        .into_iter()
        .map(|m| if m == old.person_name { new.person_name.clone() } else { m })
        .collect();
    if !members.contains(&new.person_name) {
        members.push(new.person_name.clone());
    }

    transaction::update_transaction_in(
        conn,
        existing.user_id,
        family_id,
        txn_id,
        &CreateTransactionRequest {
            category_id,
            subcategory_id,
            r#type: ledger_type(&new.r#type).to_string(),
            amount: new.amount,
            currency: new.currency.clone(),
            date: new.date,
            time: existing.time,
            location: existing.location.clone(),
            note,
            members: Some(members),
        },
    )
    .await?;
    Ok(())
}

/// Delete a gift together with the ledger entry it was booked as, if any.
pub async fn delete_social_gift(
    pool: &PgPool,
    family_id: Uuid,
    gift_id: Uuid,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    let deleted: Option<Option<Uuid>> = sqlx::query_scalar(
        "DELETE FROM social_gifts WHERE id = $1 AND family_id = $2 RETURNING transaction_id",
    )
    .bind(gift_id)
    .bind(family_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(transaction_id) = deleted else {
        return Err(AppError::NotFound("Social gift not found".to_string()));
    };

    if let Some(txn_id) = transaction_id {
        sqlx::query("DELETE FROM transactions WHERE id = $1 AND family_id = $2")
            .bind(txn_id)
            .bind(family_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_gift_wording() {
        assert_eq!(normalize_gift_type("given"), Some("give"));
        assert_eq!(normalize_gift_type("收到"), Some("receive"));
        assert_eq!(normalize_gift_type("maybe"), None);

        assert_eq!(normalize_occasion(Some("结婚")), ("婚礼".to_string(), None));
        assert_eq!(normalize_occasion(Some("拜年")), ("节日".to_string(), None));
        assert_eq!(
            normalize_occasion(Some("见面礼")),
            ("其他".to_string(), Some("见面礼".to_string()))
        );
        assert_eq!(normalize_relation("表哥"), "亲戚");
        assert_eq!(normalize_relation("领导"), "同事");
    }

    #[test]
    fn picks_ledger_subcategory_and_note() {
        assert_eq!(ledger_subcategory("give", Some("礼物")), "礼物");
        assert_eq!(ledger_subcategory("give", None), "红包礼金");
        assert_eq!(ledger_subcategory("receive", Some("礼金")), "收到礼金");
        assert_eq!(ledger_subcategory("receive", None), "收到红包");

        assert_eq!(ledger_note("婚礼", None, Some("红包")).as_deref(), Some("婚礼红包"));
        assert_eq!(ledger_note("生日", Some("牛牛生日红包"), None).as_deref(), Some("牛牛生日红包"));
        assert_eq!(ledger_note("其他", Some("黄丹丹买的补品"), None).as_deref(), Some("黄丹丹买的补品"));
        assert_eq!(ledger_note("其他", None, None), None);
    }
}
