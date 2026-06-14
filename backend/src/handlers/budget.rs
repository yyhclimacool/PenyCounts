use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{
    Budget, BudgetRequest, BudgetWithSpent, SavingsGoal, SavingsGoalRequest,
};
use crate::services;

// ── Budgets ──────────────────────────────────────────────────────────

pub async fn list_budgets(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<BudgetWithSpent>>, AppError> {
    let data = services::budget::list_budgets(&state.pool, auth.family_id).await?;
    Ok(Json(data))
}

pub async fn create_budget(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<BudgetRequest>,
) -> Result<(StatusCode, Json<Budget>), AppError> {
    let budget =
        services::budget::create_budget(&state.pool, auth.user_id, auth.family_id, req).await?;
    Ok((StatusCode::CREATED, Json(budget)))
}

pub async fn update_budget(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<BudgetRequest>,
) -> Result<Json<Budget>, AppError> {
    let budget = services::budget::update_budget(&state.pool, auth.family_id, id, req).await?;
    Ok(Json(budget))
}

pub async fn delete_budget(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    services::budget::delete_budget(&state.pool, auth.family_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Savings goals ────────────────────────────────────────────────────

pub async fn list_goals(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<SavingsGoal>>, AppError> {
    let data = services::budget::list_goals(&state.pool, auth.family_id).await?;
    Ok(Json(data))
}

pub async fn create_goal(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<SavingsGoalRequest>,
) -> Result<(StatusCode, Json<SavingsGoal>), AppError> {
    let goal =
        services::budget::create_goal(&state.pool, auth.user_id, auth.family_id, req).await?;
    Ok((StatusCode::CREATED, Json(goal)))
}

pub async fn update_goal(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<SavingsGoalRequest>,
) -> Result<Json<SavingsGoal>, AppError> {
    let goal = services::budget::update_goal(&state.pool, auth.family_id, id, req).await?;
    Ok(Json(goal))
}

pub async fn delete_goal(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    services::budget::delete_goal(&state.pool, auth.family_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
