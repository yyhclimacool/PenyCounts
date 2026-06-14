use axum::{extract::State, Json};

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{SettingsExport, SettingsImportResult};
use crate::services;

pub async fn export_settings(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<SettingsExport>, AppError> {
    let export =
        services::settings::export_settings(&state.pool, auth.user_id, auth.family_id).await?;
    Ok(Json(export))
}

pub async fn import_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(data): Json<SettingsExport>,
) -> Result<Json<SettingsImportResult>, AppError> {
    let result =
        services::settings::import_settings(&state.pool, auth.user_id, auth.family_id, data).await?;
    Ok(Json(result))
}
