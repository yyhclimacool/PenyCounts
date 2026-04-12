use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{
    CreateTransactionRequest, PaginatedResponse, Transaction, TransactionFilter,
    TransactionMember, TransactionWithMembers,
};
use crate::services;

pub async fn list_transactions(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(filter): Query<TransactionFilter>,
) -> Result<Json<PaginatedResponse<TransactionWithMembers>>, AppError> {
    let result =
        services::transaction::list_transactions(&state.pool, auth.user_id, filter).await?;

    let txn_ids: Vec<Uuid> = result.data.iter().map(|t| t.id).collect();

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
    let txn = services::transaction::get_transaction(&state.pool, auth.user_id, id).await?;
    Ok(Json(txn))
}

pub async fn create_transaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateTransactionRequest>,
) -> Result<(StatusCode, Json<Transaction>), AppError> {
    let txn =
        services::transaction::create_transaction(&state.pool, auth.user_id, req).await?;
    Ok((StatusCode::CREATED, Json(txn)))
}

pub async fn update_transaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateTransactionRequest>,
) -> Result<Json<Transaction>, AppError> {
    let txn =
        services::transaction::update_transaction(&state.pool, auth.user_id, id, req).await?;
    Ok(Json(txn))
}

pub async fn delete_transaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    services::transaction::delete_transaction(&state.pool, auth.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_transaction_members(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<TransactionMember>>, AppError> {
    let members = services::transaction::get_transaction_members(&state.pool, id).await?;
    Ok(Json(members))
}
