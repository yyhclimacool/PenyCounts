use axum::{extract::State, Json};

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::InsightsResponse;
use crate::services;

pub async fn get_insights(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<InsightsResponse>, AppError> {
    tracing::debug!(family_id = %auth.family_id, "get_insights: received request");
    let data = services::insights::generate(&state.pool, auth.family_id).await?;
    tracing::debug!(family_id = %auth.family_id, cards = data.cards.len(), "get_insights: returning");
    Ok(Json(data))
}
