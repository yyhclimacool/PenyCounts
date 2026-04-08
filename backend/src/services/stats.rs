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
    let rows = sqlx::query_as::<_, MonthlyTrendItem>(
        "SELECT
             EXTRACT(MONTH FROM date)::int4 AS month,
             COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2
         GROUP BY EXTRACT(MONTH FROM date)
         ORDER BY month",
    )
    .bind(user_id)
    .bind(year)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn monthly_detail(
    pool: &PgPool,
    user_id: Uuid,
    year: i32,
    month: u32,
) -> Result<Vec<Transaction>, AppError> {
    let transactions = sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM date) = $2
           AND EXTRACT(MONTH FROM date) = $3
         ORDER BY date DESC, time DESC",
    )
    .bind(user_id)
    .bind(year)
    .bind(month as i32)
    .fetch_all(pool)
    .await?;

    Ok(transactions)
}

pub async fn category_breakdown(
    pool: &PgPool,
    user_id: Uuid,
    start_date: chrono::NaiveDate,
    end_date: chrono::NaiveDate,
    txn_type: Option<&str>,
) -> Result<Vec<CategoryBreakdown>, AppError> {
    let effective_type = txn_type.unwrap_or("expense");

    let mut rows = sqlx::query_as::<_, CategoryBreakdown>(
        "SELECT
             c.name  AS category_name,
             c.icon  AS icon,
             COALESCE(SUM(t.amount), 0) AS total,
             0.0::float8 AS percentage
         FROM transactions t
         JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1
           AND t.date >= $2
           AND t.date <= $3
           AND t.type = $4
         GROUP BY c.name, c.icon
         ORDER BY total DESC",
    )
    .bind(user_id)
    .bind(start_date)
    .bind(end_date)
    .bind(effective_type)
    .fetch_all(pool)
    .await?;

    let grand_total: Decimal = rows.iter().map(|r| r.total).sum();
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
    start_date: chrono::NaiveDate,
    end_date: chrono::NaiveDate,
) -> Result<Vec<MemberBreakdown>, AppError> {
    let rows = sqlx::query_as::<_, MemberBreakdown>(
        "SELECT
             tm.member_name,
             COALESCE(SUM(tm.share_amount), 0) AS total
         FROM transaction_members tm
         JOIN transactions t ON tm.transaction_id = t.id
         WHERE t.user_id = $1
           AND t.date >= $2
           AND t.date <= $3
         GROUP BY tm.member_name
         ORDER BY total DESC",
    )
    .bind(user_id)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn social_summary(
    pool: &PgPool,
    user_id: Uuid,
    year: i32,
) -> Result<Vec<SocialSummary>, AppError> {
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

    Ok(rows)
}
