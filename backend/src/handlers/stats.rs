use axum::{
    extract::{Query, State},
    Json,
};

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{
    CategoryBreakdown, MemberBreakdown, MonthlyTrendItem, SocialSummary,
    StatsBreakdownQuery, StatsMemberQuery, StatsYearMonthQuery, StatsYearQuery, Transaction,
};
use crate::services;

pub async fn monthly_trend(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<StatsYearQuery>,
) -> Result<Json<Vec<MonthlyTrendItem>>, AppError> {
    tracing::debug!(user_id = %auth.user_id, year = query.year, "monthly_trend: received request");
    let data =
        services::stats::monthly_trend(&state.pool, auth.user_id, query.year).await?;
    tracing::debug!(user_id = %auth.user_id, rows = data.len(), "monthly_trend: returning data");
    Ok(Json(data))
}

pub async fn monthly_detail(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<StatsYearMonthQuery>,
) -> Result<Json<Vec<Transaction>>, AppError> {
    tracing::debug!(user_id = %auth.user_id, year = query.year, month = query.month, "monthly_detail: received request");
    let data = services::stats::monthly_detail(
        &state.pool,
        auth.user_id,
        query.year,
        query.month,
    )
    .await?;
    tracing::debug!(user_id = %auth.user_id, count = data.len(), "monthly_detail: returning transactions");
    Ok(Json(data))
}

pub async fn category_breakdown(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<StatsBreakdownQuery>,
) -> Result<Json<Vec<CategoryBreakdown>>, AppError> {
    tracing::debug!(
        user_id = %auth.user_id,
        year = query.year,
        month = ?query.month,
        r#type = ?query.r#type,
        "category_breakdown: received request"
    );
    let data = services::stats::category_breakdown(
        &state.pool,
        auth.user_id,
        query.year,
        query.month,
        query.r#type.as_deref(),
    )
    .await?;
    tracing::debug!(user_id = %auth.user_id, categories = data.len(), "category_breakdown: returning data");
    Ok(Json(data))
}

pub async fn member_breakdown(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<StatsMemberQuery>,
) -> Result<Json<Vec<MemberBreakdown>>, AppError> {
    tracing::debug!(
        user_id = %auth.user_id,
        year = query.year,
        month = ?query.month,
        "member_breakdown: received request"
    );
    let data = services::stats::member_breakdown(
        &state.pool,
        auth.user_id,
        query.year,
        query.month,
    )
    .await?;
    tracing::debug!(user_id = %auth.user_id, members = data.len(), "member_breakdown: returning data");
    Ok(Json(data))
}

pub async fn social_summary(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<StatsYearQuery>,
) -> Result<Json<Vec<SocialSummary>>, AppError> {
    tracing::debug!(user_id = %auth.user_id, year = query.year, "social_summary: received request");
    let data =
        services::stats::social_summary(&state.pool, auth.user_id, query.year).await?;
    tracing::debug!(user_id = %auth.user_id, rows = data.len(), "social_summary: returning data");
    Ok(Json(data))
}
