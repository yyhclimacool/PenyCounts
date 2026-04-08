use chrono::Utc;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    CreateTransactionRequest, PaginatedResponse, Transaction, TransactionFilter,
    TransactionMember,
};

pub async fn create_transaction(
    pool: &PgPool,
    user_id: Uuid,
    req: CreateTransactionRequest,
) -> Result<Transaction, AppError> {
    let mut tx = pool.begin().await?;

    let txn_id = Uuid::new_v4();
    let now = Utc::now();

    let transaction = sqlx::query_as::<_, Transaction>(
        "INSERT INTO transactions (id, user_id, category_id, subcategory_id, type, amount, currency, date, time, location, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *",
    )
    .bind(txn_id)
    .bind(user_id)
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
            }
        }
    }

    tx.commit().await?;
    Ok(transaction)
}

pub async fn get_transaction(
    pool: &PgPool,
    user_id: Uuid,
    txn_id: Uuid,
) -> Result<Transaction, AppError> {
    sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions WHERE id = $1 AND user_id = $2",
    )
    .bind(txn_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Transaction not found".to_string()))
}

pub async fn get_transaction_members(
    pool: &PgPool,
    txn_id: Uuid,
) -> Result<Vec<TransactionMember>, AppError> {
    let members = sqlx::query_as::<_, TransactionMember>(
        "SELECT * FROM transaction_members WHERE transaction_id = $1 ORDER BY member_name",
    )
    .bind(txn_id)
    .fetch_all(pool)
    .await?;

    Ok(members)
}

pub async fn list_transactions(
    pool: &PgPool,
    user_id: Uuid,
    filter: TransactionFilter,
) -> Result<PaginatedResponse<Transaction>, AppError> {
    let page = filter.page.unwrap_or(1).max(1);
    let per_page = filter.per_page.unwrap_or(20).min(100);
    let offset = ((page - 1) * per_page) as i64;

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM transactions
         WHERE user_id = $1
           AND ($2::date IS NULL OR date >= $2)
           AND ($3::date IS NULL OR date <= $3)
           AND ($4::uuid IS NULL OR category_id = $4)
           AND ($5::text IS NULL OR type = $5)
           AND ($6::text IS NULL OR note ILIKE '%' || $6 || '%' OR location ILIKE '%' || $6 || '%')",
    )
    .bind(user_id)
    .bind(filter.start_date)
    .bind(filter.end_date)
    .bind(filter.category_id)
    .bind(&filter.r#type)
    .bind(&filter.search)
    .fetch_one(pool)
    .await?;

    let transactions = sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions
         WHERE user_id = $1
           AND ($2::date IS NULL OR date >= $2)
           AND ($3::date IS NULL OR date <= $3)
           AND ($4::uuid IS NULL OR category_id = $4)
           AND ($5::text IS NULL OR type = $5)
           AND ($6::text IS NULL OR note ILIKE '%' || $6 || '%' OR location ILIKE '%' || $6 || '%')
         ORDER BY date DESC, time DESC
         LIMIT $7 OFFSET $8",
    )
    .bind(user_id)
    .bind(filter.start_date)
    .bind(filter.end_date)
    .bind(filter.category_id)
    .bind(&filter.r#type)
    .bind(&filter.search)
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
    txn_id: Uuid,
    req: CreateTransactionRequest,
) -> Result<Transaction, AppError> {
    let mut tx = pool.begin().await?;

    let existing = sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions WHERE id = $1 AND user_id = $2",
    )
    .bind(txn_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Transaction not found".to_string()))?;

    let _ = existing;

    let transaction = sqlx::query_as::<_, Transaction>(
        "UPDATE transactions
         SET category_id = $1, subcategory_id = $2, type = $3, amount = $4, currency = $5,
             date = $6, time = $7, location = $8, note = $9
         WHERE id = $10 AND user_id = $11
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
    .bind(user_id)
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
            }
        }
    }

    tx.commit().await?;
    Ok(transaction)
}

pub async fn delete_transaction(
    pool: &PgPool,
    user_id: Uuid,
    txn_id: Uuid,
) -> Result<(), AppError> {
    let result =
        sqlx::query("DELETE FROM transactions WHERE id = $1 AND user_id = $2")
            .bind(txn_id)
            .bind(user_id)
            .execute(pool)
            .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Transaction not found".to_string()));
    }

    Ok(())
}
