use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    CategoryBreakdown, DailyTrendItem, MemberBreakdown, MonthlyTrendItem, SocialSummary,
    Transaction, YearlyTrendItem,
};

pub async fn monthly_trend(
    pool: &PgPool,
    user_id: Uuid,
    year: i32,
) -> Result<Vec<MonthlyTrendItem>, AppError> {
    tracing::debug!(user_id = %user_id, year = year, "svc::monthly_trend: querying");
    let rows = sqlx::query_as::<_, MonthlyTrendItem>(
        "SELECT
             EXTRACT(MONTH FROM date)::int4 AS month,
             COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date)::int4 = $2
         GROUP BY EXTRACT(MONTH FROM date)
         ORDER BY month",
    )
    .bind(user_id)
    .bind(year)
    .fetch_all(pool)
    .await?;
    tracing::debug!(rows = rows.len(), "svc::monthly_trend: done");

    Ok(rows)
}

pub async fn monthly_detail(
    pool: &PgPool,
    user_id: Uuid,
    year: i32,
    month: u32,
) -> Result<Vec<Transaction>, AppError> {
    tracing::debug!(user_id = %user_id, year = year, month = month, "svc::monthly_detail: querying");
    let transactions = sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM date)::int4 = $2
           AND EXTRACT(MONTH FROM date)::int4 = $3
         ORDER BY date DESC, time DESC",
    )
    .bind(user_id)
    .bind(year)
    .bind(month as i32)
    .fetch_all(pool)
    .await?;
    tracing::debug!(count = transactions.len(), "svc::monthly_detail: done");

    Ok(transactions)
}

pub async fn category_breakdown(
    pool: &PgPool,
    user_id: Uuid,
    year: i32,
    month: Option<u32>,
    txn_type: Option<&str>,
) -> Result<Vec<CategoryBreakdown>, AppError> {
    let effective_type = txn_type.unwrap_or("expense");
    tracing::debug!(
        user_id = %user_id,
        year = year,
        month = ?month,
        effective_type = effective_type,
        "svc::category_breakdown: querying"
    );

    let mut rows = sqlx::query_as::<_, CategoryBreakdown>(
        "SELECT
             c.name  AS category_name,
             c.icon  AS icon,
             COALESCE(SUM(t.amount), 0) AS total,
             0.0::float8 AS percentage
         FROM transactions t
         JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1
           AND EXTRACT(YEAR FROM t.date)::int4 = $2
           AND ($3::int4 IS NULL OR EXTRACT(MONTH FROM t.date)::int4 = $3)
           AND t.type = $4
         GROUP BY c.name, c.icon
         ORDER BY total DESC",
    )
    .bind(user_id)
    .bind(year)
    .bind(month.map(|m| m as i32))
    .bind(effective_type)
    .fetch_all(pool)
    .await?;
    tracing::debug!(categories = rows.len(), "svc::category_breakdown: raw query done");

    let grand_total: Decimal = rows.iter().map(|r| r.total).sum();
    tracing::debug!(grand_total = %grand_total, "svc::category_breakdown: computing percentages");
    if !grand_total.is_zero() {
        for row in &mut rows {
            let ratio = row.total.to_string().parse::<f64>().unwrap_or(0.0)
                / grand_total.to_string().parse::<f64>().unwrap_or(1.0);
            row.percentage = (ratio * 10000.0).round() / 100.0;
        }
    }

    Ok(rows)
}

pub async fn member_breakdown(
    pool: &PgPool,
    user_id: Uuid,
    year: i32,
    month: Option<u32>,
    txn_type: Option<&str>,
) -> Result<Vec<MemberBreakdown>, AppError> {
    tracing::debug!(
        user_id = %user_id,
        year = year,
        month = ?month,
        r#type = ?txn_type,
        "svc::member_breakdown: querying"
    );
    let rows = sqlx::query_as::<_, MemberBreakdown>(
        "SELECT
             tm.member_name,
             COALESCE(SUM(tm.share_amount), 0) AS total
         FROM transaction_members tm
         JOIN transactions t ON tm.transaction_id = t.id
         WHERE t.user_id = $1
           AND EXTRACT(YEAR FROM t.date)::int4 = $2
           AND ($3::int4 IS NULL OR EXTRACT(MONTH FROM t.date)::int4 = $3)
           AND ($4::text IS NULL OR t.type = $4)
         GROUP BY tm.member_name
         ORDER BY total DESC",
    )
    .bind(user_id)
    .bind(year)
    .bind(month.map(|m| m as i32))
    .bind(txn_type)
    .fetch_all(pool)
    .await?;
    tracing::debug!(members = rows.len(), "svc::member_breakdown: done");

    Ok(rows)
}

pub async fn social_summary(
    pool: &PgPool,
    user_id: Uuid,
    year: i32,
) -> Result<Vec<SocialSummary>, AppError> {
    tracing::debug!(user_id = %user_id, year = year, "svc::social_summary: querying from transactions");
    let rows = sqlx::query_as::<_, SocialSummary>(
        "SELECT
             tm.member_name AS person_name,
             COALESCE(SUM(CASE WHEN t.type = 'expense' THEN tm.share_amount ELSE 0 END), 0) AS given,
             COALESCE(SUM(CASE WHEN t.type = 'income'  THEN tm.share_amount ELSE 0 END), 0) AS received,
             COALESCE(
                 SUM(CASE WHEN t.type = 'income'  THEN tm.share_amount ELSE 0 END)
               - SUM(CASE WHEN t.type = 'expense' THEN tm.share_amount ELSE 0 END),
                 0
             ) AS net
         FROM transactions t
         JOIN categories c ON t.category_id = c.id
         JOIN transaction_members tm ON tm.transaction_id = t.id
         WHERE t.user_id = $1
           AND EXTRACT(YEAR FROM t.date)::int4 = $2
           AND c.name LIKE '%人情%'
         GROUP BY tm.member_name
         ORDER BY tm.member_name",
    )
    .bind(user_id)
    .bind(year)
    .fetch_all(pool)
    .await?;
    tracing::debug!(rows = rows.len(), "svc::social_summary: done");

    Ok(rows)
}

pub async fn daily_trend(
    pool: &PgPool,
    user_id: Uuid,
    year: i32,
    month: u32,
) -> Result<Vec<DailyTrendItem>, AppError> {
    tracing::debug!(user_id = %user_id, year = year, month = month, "svc::daily_trend: querying");
    let rows = sqlx::query_as::<_, DailyTrendItem>(
        "SELECT
             EXTRACT(DAY FROM date)::int4 AS day,
             COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM date)::int4 = $2
           AND EXTRACT(MONTH FROM date)::int4 = $3
         GROUP BY EXTRACT(DAY FROM date)
         ORDER BY day",
    )
    .bind(user_id)
    .bind(year)
    .bind(month as i32)
    .fetch_all(pool)
    .await?;
    tracing::debug!(rows = rows.len(), "svc::daily_trend: done");

    Ok(rows)
}

pub async fn yearly_trend(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<YearlyTrendItem>, AppError> {
    tracing::debug!(user_id = %user_id, "svc::yearly_trend: querying");
    let rows = sqlx::query_as::<_, YearlyTrendItem>(
        "SELECT
             EXTRACT(YEAR FROM date)::int4 AS year,
             COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE user_id = $1
         GROUP BY EXTRACT(YEAR FROM date)
         ORDER BY year",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    tracing::debug!(rows = rows.len(), "svc::yearly_trend: done");

    Ok(rows)
}
