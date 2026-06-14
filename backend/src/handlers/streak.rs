use axum::{extract::State, Json};

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::StreakResponse;
use crate::services;

pub async fn get_streak(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<StreakResponse>, AppError> {
    let data = services::streak::generate(&state.pool, auth.family_id).await?;
    Ok(Json(data))
}
