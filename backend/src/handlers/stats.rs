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
    let data =
        services::stats::monthly_trend(&state.pool, auth.user_id, query.year).await?;
    Ok(Json(data))
}

pub async fn monthly_detail(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<StatsYearMonthQuery>,
) -> Result<Json<Vec<Transaction>>, AppError> {
    let data = services::stats::monthly_detail(
        &state.pool,
        auth.user_id,
        query.year,
        query.month,
    )
    .await?;
    Ok(Json(data))
}

pub async fn category_breakdown(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<StatsBreakdownQuery>,
) -> Result<Json<Vec<CategoryBreakdown>>, AppError> {
    let data = services::stats::category_breakdown(
        &state.pool,
        auth.user_id,
        query.start_date,
        query.end_date,
        query.r#type.as_deref(),
    )
    .await?;
    Ok(Json(data))
}

pub async fn member_breakdown(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<StatsMemberQuery>,
) -> Result<Json<Vec<MemberBreakdown>>, AppError> {
    let data = services::stats::member_breakdown(
        &state.pool,
        auth.user_id,
        query.start_date,
        query.end_date,
    )
    .await?;
    Ok(Json(data))
}

pub async fn social_summary(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<StatsYearQuery>,
) -> Result<Json<Vec<SocialSummary>>, AppError> {
    let data =
        services::stats::social_summary(&state.pool, auth.user_id, query.year).await?;
    Ok(Json(data))
}
