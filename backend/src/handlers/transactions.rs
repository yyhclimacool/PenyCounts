use axum::{
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::IntoResponse,
    Json,
};
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{
    CreateTransactionRequest, ImportCsvRequest, ImportResult, PaginatedResponse, Transaction,
    TransactionFilter, TransactionMember, TransactionWithMembers,
};
use crate::services;

pub async fn list_transactions(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(filter): Query<TransactionFilter>,
) -> Result<Json<PaginatedResponse<TransactionWithMembers>>, AppError> {
    tracing::debug!(user_id = %auth.family_id, ?filter, "list_transactions: received request");
    let result =
        services::transaction::list_transactions(&state.pool, auth.family_id, filter).await?;

    let txn_ids: Vec<Uuid> = result.data.iter().map(|t| t.id).collect();
    tracing::debug!(count = txn_ids.len(), "list_transactions: fetched transactions, loading members");

    let all_members = if txn_ids.is_empty() {
        vec![]
    } else {
        sqlx::query_as::<_, TransactionMember>(
            "SELECT * FROM transaction_members WHERE transaction_id = ANY($1) ORDER BY member_name",
        )
        .bind(&txn_ids)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default()
    };
    tracing::debug!(member_count = all_members.len(), "list_transactions: loaded transaction members");

    let mut members_map: std::collections::HashMap<Uuid, Vec<TransactionMember>> =
        std::collections::HashMap::new();
    for m in all_members {
        members_map.entry(m.transaction_id).or_default().push(m);
    }

    let enriched: Vec<TransactionWithMembers> = result
        .data
        .into_iter()
        .map(|tx| {
            let members = members_map.remove(&tx.id).unwrap_or_default();
            TransactionWithMembers { transaction: tx, members }
        })
        .collect();

    tracing::debug!(
        total = result.total,
        page = result.page,
        per_page = result.per_page,
        returned = enriched.len(),
        "list_transactions: response ready"
    );

    Ok(Json(PaginatedResponse {
        data: enriched,
        total: result.total,
        page: result.page,
        per_page: result.per_page,
    }))
}

pub async fn get_transaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Transaction>, AppError> {
    tracing::debug!(user_id = %auth.family_id, txn_id = %id, "get_transaction: received request");
    let txn = services::transaction::get_transaction(&state.pool, auth.family_id, id).await?;
    tracing::debug!(txn_id = %txn.id, r#type = %txn.r#type, amount = %txn.amount, "get_transaction: returning transaction");
    Ok(Json(txn))
}

pub async fn create_transaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateTransactionRequest>,
) -> Result<(StatusCode, Json<Transaction>), AppError> {
    tracing::debug!(
        user_id = %auth.family_id,
        r#type = %req.r#type,
        amount = %req.amount,
        currency = %req.currency,
        category_id = %req.category_id,
        subcategory_id = ?req.subcategory_id,
        date = %req.date,
        time = %req.time,
        location = ?req.location,
        note = ?req.note,
        members = ?req.members,
        "create_transaction: received request"
    );
    let txn =
        services::transaction::create_transaction(&state.pool, auth.user_id, auth.family_id, req).await?;
    tracing::info!(txn_id = %txn.id, amount = %txn.amount, "create_transaction: created successfully");
    Ok((StatusCode::CREATED, Json(txn)))
}

pub async fn update_transaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateTransactionRequest>,
) -> Result<Json<Transaction>, AppError> {
    tracing::debug!(
        user_id = %auth.family_id,
        txn_id = %id,
        r#type = %req.r#type,
        amount = %req.amount,
        currency = %req.currency,
        category_id = %req.category_id,
        subcategory_id = ?req.subcategory_id,
        date = %req.date,
        time = %req.time,
        location = ?req.location,
        note = ?req.note,
        members = ?req.members,
        "update_transaction: received request"
    );
    let txn =
        services::transaction::update_transaction(&state.pool, auth.family_id, id, req).await?;
    tracing::info!(txn_id = %txn.id, amount = %txn.amount, "update_transaction: updated successfully");
    Ok(Json(txn))
}

pub async fn delete_transaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    tracing::debug!(user_id = %auth.family_id, txn_id = %id, "delete_transaction: received request");
    services::transaction::delete_transaction(&state.pool, auth.family_id, id).await?;
    tracing::info!(txn_id = %id, "delete_transaction: deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn clear_all_transactions(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    tracing::warn!(family_id = %auth.family_id, "clear_all_transactions: received request");
    let deleted = services::transaction::clear_all_transactions(&state.pool, auth.family_id).await?;
    tracing::warn!(family_id = %auth.family_id, deleted, "clear_all_transactions: done");
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

pub async fn export_csv(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(filter): Query<TransactionFilter>,
) -> Result<impl IntoResponse, AppError> {
    let csv = services::transaction::export_csv(&state.pool, auth.family_id, filter).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"transactions.csv\""),
        ],
        csv,
    ))
}

pub async fn import_csv(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ImportCsvRequest>,
) -> Result<Json<ImportResult>, AppError> {
    tracing::info!(user_id = %auth.family_id, content_len = req.content.len(), "import_csv: received request");
    let result =
        services::transaction::import_csv(&state.pool, auth.user_id, auth.family_id, &req.content).await?;
    tracing::info!(
        total = result.total,
        imported = result.imported,
        skipped = result.skipped,
        "import_csv: completed"
    );
    Ok(Json(result))
}

pub async fn get_transaction_members(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<TransactionMember>>, AppError> {
    tracing::debug!(txn_id = %id, "get_transaction_members: received request");
    let members = services::transaction::get_transaction_members(&state.pool, id).await?;
    tracing::debug!(txn_id = %id, count = members.len(), "get_transaction_members: returning members");
    Ok(Json(members))
}
