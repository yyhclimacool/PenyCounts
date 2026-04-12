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
    tracing::debug!(
        user_id = %user_id,
        r#type = %req.r#type,
        amount = %req.amount,
        category_id = %req.category_id,
        subcategory_id = ?req.subcategory_id,
        members = ?req.members,
        "svc::create_transaction: starting"
    );
    let mut tx = pool.begin().await?;

    let txn_id = Uuid::new_v4();
    let now = Utc::now();
    tracing::debug!(txn_id = %txn_id, "svc::create_transaction: generated new txn_id");

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
    tracing::debug!(txn_id = %transaction.id, "svc::create_transaction: INSERT into transactions done");

    if let Some(members) = &req.members {
        if !members.is_empty() {
            let member_count = Decimal::from(members.len() as i64);
            let share = req.amount / member_count;
            tracing::debug!(
                member_count = members.len(),
                share_each = %share,
                "svc::create_transaction: inserting members"
            );

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
                tracing::debug!(member = %member_name, share = %share, "svc::create_transaction: inserted transaction_member");

                sqlx::query(
                    "INSERT INTO members (id, user_id, name)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (user_id, name) DO NOTHING",
                )
                .bind(Uuid::new_v4())
                .bind(user_id)
                .bind(member_name)
                .execute(&mut *tx)
                .await?;
                tracing::debug!(member = %member_name, "svc::create_transaction: upserted global member");
            }
        } else {
            tracing::debug!("svc::create_transaction: members list is empty, skipping");
        }
    } else {
        tracing::debug!("svc::create_transaction: no members field provided");
    }

    tx.commit().await?;
    tracing::debug!(txn_id = %transaction.id, "svc::create_transaction: transaction committed");
    Ok(transaction)
}

pub async fn get_transaction(
    pool: &PgPool,
    user_id: Uuid,
    txn_id: Uuid,
) -> Result<Transaction, AppError> {
    tracing::debug!(user_id = %user_id, txn_id = %txn_id, "svc::get_transaction: querying");
    let txn = sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions WHERE id = $1 AND user_id = $2",
    )
    .bind(txn_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        tracing::debug!(txn_id = %txn_id, "svc::get_transaction: not found");
        AppError::NotFound("Transaction not found".to_string())
    })?;
    tracing::debug!(txn_id = %txn.id, r#type = %txn.r#type, amount = %txn.amount, "svc::get_transaction: found");
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
    user_id: Uuid,
    filter: TransactionFilter,
) -> Result<PaginatedResponse<Transaction>, AppError> {
    let page = filter.page.unwrap_or(1).max(1);
    let per_page = filter.per_page.unwrap_or(20).min(100);
    let offset = ((page - 1) * per_page) as i64;
    tracing::debug!(
        user_id = %user_id,
        page = page,
        per_page = per_page,
        offset = offset,
        start_date = ?filter.start_date,
        end_date = ?filter.end_date,
        category_id = ?filter.category_id,
        r#type = ?filter.r#type,
        search = ?filter.search,
        member_name = ?filter.member_name,
        "svc::list_transactions: executing count query"
    );

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT t.id)::bigint FROM transactions t
         LEFT JOIN transaction_members tm ON tm.transaction_id = t.id
         WHERE t.user_id = $1
           AND ($2::date IS NULL OR t.date >= $2)
           AND ($3::date IS NULL OR t.date <= $3)
           AND ($4::uuid IS NULL OR t.category_id = $4)
           AND ($5::text IS NULL OR t.type = $5)
           AND ($6::text IS NULL OR t.note ILIKE '%' || $6 || '%' OR t.location ILIKE '%' || $6 || '%' OR tm.member_name ILIKE '%' || $6 || '%')
           AND ($7::text IS NULL OR tm.member_name = $7)",
    )
    .bind(user_id)
    .bind(filter.start_date)
    .bind(filter.end_date)
    .bind(filter.category_id)
    .bind(&filter.r#type)
    .bind(&filter.search)
    .bind(&filter.member_name)
    .fetch_one(pool)
    .await?;
    tracing::debug!(total = total.0, "svc::list_transactions: count result");

    tracing::debug!("svc::list_transactions: executing data query");
    let transactions = sqlx::query_as::<_, Transaction>(
        "SELECT DISTINCT ON (t.date, t.time, t.id) t.* FROM transactions t
         LEFT JOIN transaction_members tm ON tm.transaction_id = t.id
         WHERE t.user_id = $1
           AND ($2::date IS NULL OR t.date >= $2)
           AND ($3::date IS NULL OR t.date <= $3)
           AND ($4::uuid IS NULL OR t.category_id = $4)
           AND ($5::text IS NULL OR t.type = $5)
           AND ($6::text IS NULL OR t.note ILIKE '%' || $6 || '%' OR t.location ILIKE '%' || $6 || '%' OR tm.member_name ILIKE '%' || $6 || '%')
           AND ($7::text IS NULL OR tm.member_name = $7)
         ORDER BY t.date DESC, t.time DESC, t.id
         LIMIT $8 OFFSET $9",
    )
    .bind(user_id)
    .bind(filter.start_date)
    .bind(filter.end_date)
    .bind(filter.category_id)
    .bind(&filter.r#type)
    .bind(&filter.search)
    .bind(&filter.member_name)
    .bind(per_page as i64)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    tracing::debug!(
        rows = transactions.len(),
        "svc::list_transactions: data query done"
    );

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
    tracing::debug!(
        user_id = %user_id,
        txn_id = %txn_id,
        r#type = %req.r#type,
        amount = %req.amount,
        category_id = %req.category_id,
        subcategory_id = ?req.subcategory_id,
        members = ?req.members,
        "svc::update_transaction: starting"
    );
    let mut tx = pool.begin().await?;

    let existing = sqlx::query_as::<_, Transaction>(
        "SELECT * FROM transactions WHERE id = $1 AND user_id = $2",
    )
    .bind(txn_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        tracing::debug!(txn_id = %txn_id, "svc::update_transaction: transaction not found");
        AppError::NotFound("Transaction not found".to_string())
    })?;
    tracing::debug!(
        old_type = %existing.r#type,
        old_amount = %existing.amount,
        "svc::update_transaction: found existing transaction"
    );

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
    tracing::debug!(txn_id = %transaction.id, "svc::update_transaction: UPDATE transactions done");

    let del_result = sqlx::query("DELETE FROM transaction_members WHERE transaction_id = $1")
        .bind(txn_id)
        .execute(&mut *tx)
        .await?;
    tracing::debug!(
        deleted = del_result.rows_affected(),
        "svc::update_transaction: cleared old transaction_members"
    );

    if let Some(members) = &req.members {
        if !members.is_empty() {
            let member_count = Decimal::from(members.len() as i64);
            let share = req.amount / member_count;
            tracing::debug!(
                member_count = members.len(),
                share_each = %share,
                "svc::update_transaction: inserting new members"
            );

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
                tracing::debug!(member = %member_name, "svc::update_transaction: inserted transaction_member");

                sqlx::query(
                    "INSERT INTO members (id, user_id, name)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (user_id, name) DO NOTHING",
                )
                .bind(Uuid::new_v4())
                .bind(user_id)
                .bind(member_name)
                .execute(&mut *tx)
                .await?;
                tracing::debug!(member = %member_name, "svc::update_transaction: upserted global member");
            }
        }
    }

    tx.commit().await?;
    tracing::debug!(txn_id = %transaction.id, "svc::update_transaction: transaction committed");
    Ok(transaction)
}

pub async fn delete_transaction(
    pool: &PgPool,
    user_id: Uuid,
    txn_id: Uuid,
) -> Result<(), AppError> {
    tracing::debug!(user_id = %user_id, txn_id = %txn_id, "svc::delete_transaction: executing DELETE");
    let result =
        sqlx::query("DELETE FROM transactions WHERE id = $1 AND user_id = $2")
            .bind(txn_id)
            .bind(user_id)
            .execute(pool)
            .await?;

    tracing::debug!(rows_affected = result.rows_affected(), "svc::delete_transaction: DELETE done");
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Transaction not found".to_string()));
    }

    Ok(())
}
