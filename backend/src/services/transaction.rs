use std::collections::HashMap;
use std::str::FromStr;

use chrono::{Datelike, NaiveTime, Utc};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    CreateTransactionRequest, ImportResult, PaginatedResponse, Transaction, TransactionFilter,
    TransactionMember,
};

pub async fn create_transaction(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    req: CreateTransactionRequest,
) -> Result<Transaction, AppError> {
    let mut tx = pool.begin().await?;
    let txn_id = Uuid::new_v4();
    let now = Utc::now();

    let transaction = sqlx::query_as::<_, Transaction>(
        "INSERT INTO transactions (id, user_id, family_id, category_id, subcategory_id, type, amount, currency, date, time, location, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *",
    )
    .bind(txn_id)
    .bind(user_id)
    .bind(family_id)
    .bind(req.category_id)
    .bind(req.subcategory_id)
    .bind(&req.r#type)
    .bind(req.amount)
    .bind(&req.currency)
    .bind(req.date)
    .bind(req.time)
    .bind(&req.location)
    .bind(&req.note)
    .bind(now)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(members) = &req.members {
        if !members.is_empty() {
            let member_count = Decimal::from(members.len() as i64);
            let share = req.amount / member_count;

            for member_name in members {
                sqlx::query(
                    "INSERT INTO transaction_members (id, transaction_id, member_name, share_amount)
                     VALUES ($1, $2, $3, $4)",
                )
                .bind(Uuid::new_v4())
                .bind(txn_id)
                .bind(member_name)
                .bind(share)
                .execute(&mut *tx)
                .await?;

                sqlx::query(
                    "INSERT INTO members (id, user_id, family_id, name)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (family_id, name) DO NOTHING",
                )
                .bind(Uuid::new_v4())
                .bind(user_id)
                .bind(family_id)
                .bind(member_name)
                .execute(&mut *tx)
                .await?;
            }
        }
    }

    tx.commit().await?;
    Ok(transaction)
}

pub async fn get_transaction(
    pool: &PgPool,
    family_id: Uuid,
    txn_id: Uuid,
) -> Result<Transaction, AppError> {
    let txn = sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions WHERE id = $1 AND family_id = $2",
    )
    .bind(txn_id)
    .bind(family_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Transaction not found".to_string()))?;
    Ok(txn)
}

pub async fn get_transaction_members(
    pool: &PgPool,
    txn_id: Uuid,
) -> Result<Vec<TransactionMember>, AppError> {
    tracing::debug!(txn_id = %txn_id, "svc::get_transaction_members: querying");
    let members = sqlx::query_as::<_, TransactionMember>(
        "SELECT * FROM transaction_members WHERE transaction_id = $1 ORDER BY member_name",
    )
    .bind(txn_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(txn_id = %txn_id, count = members.len(), "svc::get_transaction_members: done");
    Ok(members)
}

pub async fn list_transactions(
    pool: &PgPool,
    family_id: Uuid,
    filter: TransactionFilter,
) -> Result<PaginatedResponse<Transaction>, AppError> {
    let page = filter.page.unwrap_or(1).max(1);
    let per_page = filter.per_page.unwrap_or(20).min(100);
    let offset = ((page - 1) * per_page) as i64;

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT t.id)::bigint FROM transactions t
         LEFT JOIN transaction_members tm ON tm.transaction_id = t.id
         WHERE t.family_id = $1
           AND ($2::date IS NULL OR t.date >= $2)
           AND ($3::date IS NULL OR t.date <= $3)
           AND ($4::uuid IS NULL OR t.category_id = $4)
           AND ($5::text IS NULL OR t.type = $5)
           AND ($6::text IS NULL OR t.note ILIKE '%' || $6 || '%' OR t.location ILIKE '%' || $6 || '%' OR tm.member_name ILIKE '%' || $6 || '%')
           AND ($7::text IS NULL OR tm.member_name = $7)
           AND ($8::numeric IS NULL OR t.amount >= $8)
           AND ($9::numeric IS NULL OR t.amount <= $9)
           AND ($10::uuid IS NULL OR t.subcategory_id = $10)",
    )
    .bind(family_id)
    .bind(filter.start_date)
    .bind(filter.end_date)
    .bind(filter.category_id)
    .bind(&filter.r#type)
    .bind(&filter.search)
    .bind(&filter.member_name)
    .bind(filter.min_amount)
    .bind(filter.max_amount)
    .bind(filter.subcategory_id)
    .fetch_one(pool)
    .await?;

    let transactions = sqlx::query_as::<_, Transaction>(
        "SELECT DISTINCT ON (t.date, t.time, t.id) t.* FROM transactions t
         LEFT JOIN transaction_members tm ON tm.transaction_id = t.id
         WHERE t.family_id = $1
           AND ($2::date IS NULL OR t.date >= $2)
           AND ($3::date IS NULL OR t.date <= $3)
           AND ($4::uuid IS NULL OR t.category_id = $4)
           AND ($5::text IS NULL OR t.type = $5)
           AND ($6::text IS NULL OR t.note ILIKE '%' || $6 || '%' OR t.location ILIKE '%' || $6 || '%' OR tm.member_name ILIKE '%' || $6 || '%')
           AND ($7::text IS NULL OR tm.member_name = $7)
           AND ($8::numeric IS NULL OR t.amount >= $8)
           AND ($9::numeric IS NULL OR t.amount <= $9)
           AND ($10::uuid IS NULL OR t.subcategory_id = $10)
         ORDER BY t.date DESC, t.time DESC, t.id
         LIMIT $11 OFFSET $12",
    )
    .bind(family_id)
    .bind(filter.start_date)
    .bind(filter.end_date)
    .bind(filter.category_id)
    .bind(&filter.r#type)
    .bind(&filter.search)
    .bind(&filter.member_name)
    .bind(filter.min_amount)
    .bind(filter.max_amount)
    .bind(filter.subcategory_id)
    .bind(per_page as i64)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(PaginatedResponse {
        data: transactions,
        total: total.0,
        page,
        per_page,
    })
}

pub async fn update_transaction(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    txn_id: Uuid,
    req: CreateTransactionRequest,
) -> Result<Transaction, AppError> {
    let mut tx = pool.begin().await?;

    sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions WHERE id = $1 AND family_id = $2",
    )
    .bind(txn_id)
    .bind(family_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Transaction not found".to_string()))?;

    let transaction = sqlx::query_as::<_, Transaction>(
        "UPDATE transactions
         SET category_id = $1, subcategory_id = $2, type = $3, amount = $4, currency = $5,
             date = $6, time = $7, location = $8, note = $9
         WHERE id = $10 AND family_id = $11
         RETURNING *",
    )
    .bind(req.category_id)
    .bind(req.subcategory_id)
    .bind(&req.r#type)
    .bind(req.amount)
    .bind(&req.currency)
    .bind(req.date)
    .bind(req.time)
    .bind(&req.location)
    .bind(&req.note)
    .bind(txn_id)
    .bind(family_id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM transaction_members WHERE transaction_id = $1")
        .bind(txn_id)
        .execute(&mut *tx)
        .await?;

    if let Some(members) = &req.members {
        if !members.is_empty() {
            let member_count = Decimal::from(members.len() as i64);
            let share = req.amount / member_count;

            for member_name in members {
                sqlx::query(
                    "INSERT INTO transaction_members (id, transaction_id, member_name, share_amount)
                     VALUES ($1, $2, $3, $4)",
                )
                .bind(Uuid::new_v4())
                .bind(txn_id)
                .bind(member_name)
                .bind(share)
                .execute(&mut *tx)
                .await?;

                sqlx::query(
                    "INSERT INTO members (id, user_id, family_id, name)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (family_id, name) DO NOTHING",
                )
                .bind(Uuid::new_v4())
                .bind(user_id)
                .bind(family_id)
                .bind(member_name)
                .execute(&mut *tx)
                .await?;
            }
        }
    }

    tx.commit().await?;
    Ok(transaction)
}

pub async fn export_csv(
    pool: &PgPool,
    family_id: Uuid,
    filter: TransactionFilter,
) -> Result<String, AppError> {
    let mut conditions = vec!["t.family_id = $1".to_string()];
    let mut idx = 2u32;

    macro_rules! push_filter {
        ($opt:expr, $sql:expr) => {
            if $opt.is_some() {
                conditions.push(format!($sql, idx));
                idx += 1;
            }
        };
    }

    push_filter!(filter.start_date, "t.date >= ${}::date");
    push_filter!(filter.end_date, "t.date <= ${}::date");
    push_filter!(filter.category_id, "t.category_id = ${}::uuid");
    push_filter!(filter.r#type, "t.type = ${}::text");
    push_filter!(filter.member_name, "tm.member_name = ${}::text");
    push_filter!(filter.min_amount, "t.amount >= ${}::numeric");
    push_filter!(filter.max_amount, "t.amount <= ${}::numeric");
    push_filter!(filter.subcategory_id, "t.subcategory_id = ${}::uuid");

    let where_clause = conditions.join(" AND ");
    let sql = format!(
        "SELECT DISTINCT ON (t.date, t.created_at, t.id)
           t.note, t.date, c.name as category_name, t.amount, t.type, t.location,
           COALESCE(string_agg(DISTINCT tm.member_name, ', '), '') as members
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN transaction_members tm ON tm.transaction_id = t.id
         WHERE {}
         GROUP BY t.id, t.note, t.date, c.name, t.amount, t.type, t.location, t.created_at
         ORDER BY t.date ASC, t.created_at ASC, t.id",
        where_clause
    );

    let mut query = sqlx::query_as::<_, ExportRow>(&sql).bind(family_id);
    if let Some(v) = filter.start_date { query = query.bind(v); }
    if let Some(v) = filter.end_date { query = query.bind(v); }
    if let Some(v) = filter.category_id { query = query.bind(v); }
    if let Some(v) = &filter.r#type { query = query.bind(v); }
    if let Some(v) = &filter.member_name { query = query.bind(v); }
    if let Some(v) = filter.min_amount { query = query.bind(v); }
    if let Some(v) = filter.max_amount { query = query.bind(v); }
    if let Some(v) = filter.subcategory_id { query = query.bind(v); }

    let rows = query.fetch_all(pool).await?;

    let mut csv = String::from("\u{FEFF}备注,日期,分类,金额,收支,流水,月份,人员,地点,父记录\n");
    for row in &rows {
        let note = row.note.as_deref().unwrap_or("");
        let date_str = row.date.format("%Y/%m/%d").to_string();
        let cat = row.category_name.as_deref().unwrap_or("");
        let amount_f = row.amount.to_string();
        let type_label = if row.r#type == "income" { "收入" } else { "支出" };
        let flow = if row.r#type == "income" {
            format!("¥{}", row.amount)
        } else {
            format!("-¥{}", row.amount)
        };
        let month = format!("{} 月", row.date.month());
        let members = &row.members;
        let location = row.location.as_deref().unwrap_or("");

        let escaped_note = csv_escape(note);
        let escaped_cat = csv_escape(cat);
        let escaped_members = csv_escape(members);
        let escaped_location = csv_escape(location);

        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},\n",
            escaped_note, date_str, escaped_cat, amount_f, type_label, flow, month, escaped_members, escaped_location
        ));
    }

    Ok(csv)
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

#[derive(sqlx::FromRow)]
struct ExportRow {
    note: Option<String>,
    date: chrono::NaiveDate,
    category_name: Option<String>,
    amount: Decimal,
    r#type: String,
    location: Option<String>,
    members: String,
}

pub async fn clear_all_transactions(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<u64, AppError> {
    let result = sqlx::query("DELETE FROM transactions WHERE family_id = $1")
        .bind(family_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

pub async fn delete_transaction(
    pool: &PgPool,
    family_id: Uuid,
    txn_id: Uuid,
) -> Result<(), AppError> {
    let result =
        sqlx::query("DELETE FROM transactions WHERE id = $1 AND family_id = $2")
            .bind(txn_id)
            .bind(family_id)
            .execute(pool)
            .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Transaction not found".to_string()));
    }
    Ok(())
}

fn has_keyword(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|kw| text.contains(kw))
}

fn classify_transaction(csv_cat: &str, note: &str, txn_type: &str) -> (&'static str, Option<&'static str>) {
    let text = format!("{} {}", csv_cat.trim(), note.trim()).to_lowercase();

    // ── 收入 ──
    if txn_type == "income" {
        if has_keyword(&text, &["饭补", "补贴"]) {
            return ("工资薪酬", Some("补贴"));
        }
        if has_keyword(&text, &["顺风车", "兼职", "外快"]) {
            return ("兼职副业", Some("兼职"));
        }
        if has_keyword(&text, &["红包", "压岁", "礼金", "人情", "见面"]) {
            return ("人情收入", Some("收到红包"));
        }
        return ("其他收入", Some("其他"));
    }

    // ── 支出 ──

    // 人情往来
    if csv_cat == "人情往来"
        || has_keyword(&text, &["红包", "礼金", "拜年", "喜酒", "见面礼", "压岁钱"])
    {
        let sub = if has_keyword(&text, &["买衣服", "摇摇椅", "买鞋", "高血压药", "摘草莓"]) {
            "礼物"
        } else {
            "红包礼金"
        };
        return ("人情往来", Some(sub));
    }

    // 金融保险
    if csv_cat == "社保缴费保险"
        || has_keyword(&text, &["保险", "社保", "众安", "信用卡还款", "还房贷"])
    {
        if text.contains("还房贷") {
            return ("居家生活", Some("房租/房贷"));
        }
        return ("金融保险", Some("保险费"));
    }

    // 医疗健康
    if csv_cat == "看病药品保健"
        || has_keyword(&text, &[
            "挂号", "门诊", "医院", "挂水", "中药", "买药", "药品",
            "体检", "蛋白粉", "保健", "靶向", "肠胃", "心脏检查", "免疫", "钙片",
        ])
    {
        let sub = if has_keyword(&text, &["挂号", "门诊", "挂水", "检查", "肠胃", "心脏"]) {
            "门诊挂号"
        } else if has_keyword(&text, &["中药", "买药", "药品", "靶向", "药", "钙片"]) {
            "药品"
        } else if text.contains("体检") {
            "体检"
        } else {
            "保健品"
        };
        return ("医疗健康", Some(sub));
    }

    // 教育学习
    if csv_cat == "教育费"
        || csv_cat == "玩具育儿教育"
        || has_keyword(&text, &["学费", "学杂", "杂费", "玩具", "自行车", "三棱镜", "四驱"])
    {
        let sub = if has_keyword(&text, &["学费", "学杂", "杂费"]) {
            "学费"
        } else {
            "培训课程"
        };
        return ("教育学习", Some(sub));
    }

    // 交通出行
    if csv_cat == "爱车养车停车"
        || csv_cat == "交通和旅行"
        || has_keyword(&text, &[
            "加油", "停车", "打车", "出租", "地铁", "公交", "高速", "过路",
            "通行", "火车票", "罚款", "违章", "违停", "车船", "车险", "交强", "etc",
        ])
    {
        let sub = if text.contains("加油") {
            "加油"
        } else if text.contains("停车") {
            "停车费"
        } else if has_keyword(&text, &["打车", "出租", "高德打车", "滴滴"]) {
            "打车"
        } else if has_keyword(&text, &["高速", "过路", "etc", "通行", "火车"]) {
            "高速过路"
        } else if has_keyword(&text, &["地铁", "公交"]) {
            "公交地铁"
        } else {
            "车辆保养"
        };
        return ("交通出行", Some(sub));
    }

    // 居家生活
    if csv_cat == "生活缴费"
        || csv_cat == "生活费"
        || has_keyword(&text, &["燃气", "电费", "水电", "水费", "自来水", "物业", "快递费"])
    {
        let sub = if has_keyword(&text, &["燃气", "电费", "水电", "水费", "自来水"]) {
            "水电燃气"
        } else if text.contains("物业") {
            "物业费"
        } else {
            "家居用品"
        };
        return ("居家生活", Some(sub));
    }

    // 购物消费 - 服饰鞋包
    if csv_cat == "家居服饰鞋帽"
        || has_keyword(&text, &[
            "衣服", "鞋", "裤", "内裤", "文胸", "棉袄", "大衣", "马甲",
            "始祖鸟", "hoka", "拉杆箱", "背心裙", "貂皮", "暖宝", "羽绒",
            "adidas", "balabala", "过年装饰",
        ])
    {
        return ("购物消费", Some("服饰鞋包"));
    }

    // 购物消费 - 数码电子
    if csv_cat == "电子充值"
        || has_keyword(&text, &[
            "airpods", "iphone", "大疆", "电视屏幕", "app store",
            "苹果", "充值", "会员", "vip", "百度", "夸克", "阿里云",
            "微信读书", "腾讯", "qq", "迅雷", "cursor", "vpn", "充话费",
        ])
    {
        return ("购物消费", Some("数码电子"));
    }

    // 购物消费 - 化妆护肤
    if csv_cat == "美容美发护肤"
        || has_keyword(&text, &["护肤", "化妆", "做头发", "梳子", "美妆", "卷发", "美容"])
    {
        return ("购物消费", Some("化妆护肤"));
    }

    // 购物消费 - 日用百货
    if csv_cat == "日常生活用品"
        || has_keyword(&text, &[
            "洗手液", "抽纸", "防尘罩", "鲜花", "除臭", "伞", "木条",
            "手套", "清洁", "油壶", "锅", "卫生棉", "手机壳", "手机壳",
        ])
    {
        return ("购物消费", Some("日用百货"));
    }

    // 购物消费 - 母婴用品
    if has_keyword(&text, &["水杯", "母婴"]) {
        return ("购物消费", Some("母婴用品"));
    }

    // 购物消费 - generic
    if csv_cat == "购物"
        || has_keyword(&text, &["珍珠", "吊坠", "手表", "彩灯", "装饰", "钻戒"])
    {
        return ("购物消费", None);
    }

    // 餐饮美食
    if csv_cat == "早中晚餐"
        || csv_cat == "日常买菜零食"
        || has_keyword(&text, &[
            "午饭", "午餐", "晚饭", "晚餐", "早餐", "食堂", "外卖",
            "买菜", "零食", "水果", "草莓", "面馆", "超市", "吃饭",
            "美团", "盒马", "叮咚", "百果园", "卤", "糕点", "小笼包",
            "可乐", "北冰洋", "海鲜", "螺狮粉", "辣子鸡", "火腿",
            "面包", "鸡蛋", "香槟", "矿泉水", "炸串", "老乡鸡",
            "知味观", "卷饼", "好利来", "澳洲牛奶",
        ])
    {
        let sub = if has_keyword(&text, &["午饭", "午餐"]) {
            "午餐"
        } else if has_keyword(&text, &["晚饭", "晚餐"]) {
            "晚餐"
        } else if has_keyword(&text, &["早餐", "早饭"]) {
            "早餐"
        } else if text.contains("外卖") || (text.contains("美团") && !text.contains("买菜")) {
            "外卖"
        } else if has_keyword(&text, &["吃饭", "涮肉", "烤肉", "火锅", "面馆", "老乡鸡", "聚餐"]) {
            "聚餐"
        } else {
            "零食饮料"
        };
        return ("餐饮美食", Some(sub));
    }

    // 休闲娱乐
    if csv_cat == "娱乐消遣"
        || has_keyword(&text, &[
            "滑雪", "乒乓", "运动", "电影", "烟花", "游玩",
            "上香", "竹径", "农庄",
        ])
    {
        let sub = if has_keyword(&text, &["滑雪", "旅游", "游玩", "上香", "竹径", "农庄"]) {
            "旅游度假"
        } else if has_keyword(&text, &["乒乓", "运动"]) {
            "运动健身"
        } else if text.contains("电影") {
            "电影演出"
        } else {
            "运动健身"
        };
        return ("休闲娱乐", Some(sub));
    }

    ("其他支出", Some("其他"))
}

pub async fn import_csv(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    content: &str,
) -> Result<ImportResult, AppError> {
    let categories =
        crate::services::category::get_all_categories_with_subs(pool, family_id).await?;

    struct CatInfo {
        id: Uuid,
        subs: HashMap<String, Uuid>,
    }
    let mut cat_lookup: HashMap<(String, String), CatInfo> = HashMap::new();
    for cat in &categories {
        let subs: HashMap<String, Uuid> = cat
            .subcategories
            .iter()
            .map(|s| (s.name.clone(), s.id))
            .collect();
        cat_lookup.insert(
            (cat.name.clone(), cat.r#type.clone()),
            CatInfo { id: cat.id, subs },
        );
    }

    let content = content.trim_start_matches('\u{feff}');
    let mut reader = csv::Reader::from_reader(content.as_bytes());

    let mut total = 0usize;
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = vec![];

    let mut tx = pool.begin().await?;

    for result in reader.records() {
        total += 1;
        let row = total + 1;
        let record = match result {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("行 {}: 解析错误 - {}", row, e));
                skipped += 1;
                continue;
            }
        };

        let note = record.get(0).unwrap_or("").trim().to_string();
        let date_str = record.get(1).unwrap_or("").trim();
        let csv_category = record.get(2).unwrap_or("").trim().to_string();
        let amount_str = record.get(3).unwrap_or("").trim();
        let type_str = record.get(4).unwrap_or("").trim();
        let member_str = record.get(7).unwrap_or("").trim().to_string();
        let location = record.get(8).unwrap_or("").trim().to_string();

        let date = match chrono::NaiveDate::parse_from_str(date_str, "%Y/%m/%d") {
            Ok(d) => d,
            Err(_) => {
                errors.push(format!("行 {}: 无效日期 '{}'", row, date_str));
                skipped += 1;
                continue;
            }
        };

        let amount = match Decimal::from_str(amount_str) {
            Ok(a) => a,
            Err(_) => {
                errors.push(format!("行 {}: 无效金额 '{}'", row, amount_str));
                skipped += 1;
                continue;
            }
        };

        let txn_type = match type_str {
            "支出" => "expense",
            "收入" => "income",
            _ => {
                errors.push(format!("行 {}: 无效收支类型 '{}'", row, type_str));
                skipped += 1;
                continue;
            }
        };

        let (cat_name, sub_name) = classify_transaction(&csv_category, &note, txn_type);

        let cat_key = (cat_name.to_string(), txn_type.to_string());
        let (category_id, subcategory_id) = if let Some(info) = cat_lookup.get(&cat_key) {
            let sid = sub_name.and_then(|name| info.subs.get(name).copied());
            (info.id, sid)
        } else {
            let fallback = if txn_type == "expense" { "其他支出" } else { "其他收入" };
            let fb_key = (fallback.to_string(), txn_type.to_string());
            if let Some(info) = cat_lookup.get(&fb_key) {
                let sid = info.subs.get("其他").copied();
                (info.id, sid)
            } else {
                errors.push(format!("行 {}: 未找到匹配分类", row));
                skipped += 1;
                continue;
            }
        };

        let members: Vec<String> = if member_str.is_empty() {
            vec![]
        } else {
            member_str
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        };

        let txn_id = Uuid::new_v4();
        let now = Utc::now();
        let time = NaiveTime::from_hms_opt(0, 0, 0).unwrap();

        sqlx::query(
            "INSERT INTO transactions (id, user_id, family_id, category_id, subcategory_id, type, amount, currency, date, time, location, note, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
        )
        .bind(txn_id)
        .bind(user_id)
        .bind(family_id)
        .bind(category_id)
        .bind(subcategory_id)
        .bind(txn_type)
        .bind(amount)
        .bind("CNY")
        .bind(date)
        .bind(time)
        .bind(if location.is_empty() { None } else { Some(&location) })
        .bind(if note.is_empty() { None } else { Some(&note) })
        .bind(now)
        .execute(&mut *tx)
        .await?;

        if !members.is_empty() {
            let member_count = Decimal::from(members.len() as i64);
            let share = amount / member_count;

            for member_name in &members {
                sqlx::query(
                    "INSERT INTO transaction_members (id, transaction_id, member_name, share_amount)
                     VALUES ($1, $2, $3, $4)",
                )
                .bind(Uuid::new_v4())
                .bind(txn_id)
                .bind(member_name)
                .bind(share)
                .execute(&mut *tx)
                .await?;

                sqlx::query(
                    "INSERT INTO members (id, user_id, family_id, name)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (family_id, name) DO NOTHING",
                )
                .bind(Uuid::new_v4())
                .bind(user_id)
                .bind(family_id)
                .bind(member_name)
                .execute(&mut *tx)
                .await?;
            }
        }

        imported += 1;
    }

    tx.commit().await?;

    tracing::info!(
        total = total,
        imported = imported,
        skipped = skipped,
        "svc::import_csv: import completed"
    );

    Ok(ImportResult {
        total,
        imported,
        skipped,
        errors,
    })
}
