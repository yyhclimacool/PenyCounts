use chrono::Utc;
use jsonwebtoken::{encode, EncodingKey, Header};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::errors::AppError;
use crate::middleware::Claims;
use crate::models::{AuthResponse, LoginRequest, RegisterRequest, User, UserResponse};

pub async fn register(
    pool: &PgPool,
    config: &AppConfig,
    req: RegisterRequest,
) -> Result<AuthResponse, AppError> {
    let username = req.username.trim().to_string();
    if username.is_empty() || username.len() > 100 {
        return Err(AppError::Validation("用户名不能为空且不超过100字符".to_string()));
    }

    let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&username)
        .fetch_optional(pool)
        .await?;

    if existing.is_some() {
        return Err(AppError::BadRequest("该用户名已被注册".to_string()));
    }

    let user_id = Uuid::new_v4();
    let now = Utc::now();

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (id, email, password_hash, nickname, email_verified, verification_token, created_at, updated_at)
         VALUES ($1, $2, '', $3, true, NULL, $4, $5)
         RETURNING *",
    )
    .bind(user_id)
    .bind(&username)
    .bind(&username)
    .bind(now)
    .bind(now)
    .fetch_one(pool)
    .await?;

    let token = generate_jwt(config, user.id)?;

    Ok(AuthResponse {
        token,
        user: UserResponse::from_user(&user),
    })
}

pub async fn login(
    pool: &PgPool,
    config: &AppConfig,
    req: LoginRequest,
) -> Result<AuthResponse, AppError> {
    let username = req.username.trim().to_string();

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&username)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("用户不存在".to_string()))?;

    let token = generate_jwt(config, user.id)?;

    Ok(AuthResponse {
        token,
        user: UserResponse::from_user(&user),
    })
}

pub fn generate_jwt(config: &AppConfig, user_id: Uuid) -> Result<String, AppError> {
    let expiration = Utc::now()
        .checked_add_signed(chrono::Duration::hours(config.jwt_expiry_hours))
        .ok_or_else(|| AppError::Internal("Token expiration overflow".to_string()))?
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id,
        exp: expiration,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("JWT creation error: {}", e)))
}
