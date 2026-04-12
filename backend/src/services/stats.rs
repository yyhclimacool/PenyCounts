use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    CategoryBreakdown, MemberBreakdown, MonthlyTrendItem, SocialSummary, Transaction,
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
) -> Result<Vec<MemberBreakdown>, AppError> {
    tracing::debug!(
        user_id = %user_id,
        year = year,
        month = ?month,
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
         GROUP BY tm.member_name
         ORDER BY total DESC",
    )
    .bind(user_id)
    .bind(year)
    .bind(month.map(|m| m as i32))
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
    tracing::debug!(user_id = %user_id, year = year, "svc::social_summary: querying");
    let rows = sqlx::query_as::<_, SocialSummary>(
        "SELECT
             person_name,
             COALESCE(SUM(CASE WHEN type = 'give'    THEN amount ELSE 0 END), 0) AS given,
             COALESCE(SUM(CASE WHEN type = 'receive' THEN amount ELSE 0 END), 0) AS received,
             COALESCE(
                 SUM(CASE WHEN type = 'receive' THEN amount ELSE 0 END)
               - SUM(CASE WHEN type = 'give'    THEN amount ELSE 0 END),
                 0
             ) AS net
         FROM social_gifts
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2
         GROUP BY person_name
         ORDER BY person_name",
    )
    .bind(user_id)
    .bind(year)
    .fetch_all(pool)
    .await?;
    tracing::debug!(rows = rows.len(), "svc::social_summary: done");

    Ok(rows)
}
