use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub exp: usize,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub family_id: Uuid,
}

pub async fn resolve_family(pool: &PgPool, user_id: Uuid) -> Result<Uuid, AppError> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT u.default_family_id FROM users u \
         JOIN family_members fm ON fm.user_id = u.id AND fm.family_id = u.default_family_id \
         WHERE u.id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    row.map(|r| r.0).ok_or_else(|| {
        AppError::Unauthorized("No valid family membership".to_string())
    })
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let method = &parts.method;
        let uri = &parts.uri;

        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                tracing::debug!(%method, %uri, "auth: missing Authorization header");
                AppError::Unauthorized("Missing authorization header".to_string())
            })?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or_else(|| {
                tracing::debug!(%method, %uri, "auth: invalid Authorization header format");
                AppError::Unauthorized("Invalid authorization header format".to_string())
            })?;

        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .map_err(|e| {
            tracing::debug!(%method, %uri, error = %e, "auth: JWT decode failed");
            AppError::Unauthorized("Invalid or expired token".to_string())
        })?;

        let user_id = token_data.claims.sub;
        let family_id = resolve_family(&state.pool, user_id).await?;

        tracing::debug!(user_id = %user_id, family_id = %family_id, %method, %uri, "auth: authenticated");
        Ok(AuthUser { user_id, family_id })
    }
}
