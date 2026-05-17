use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use jsonwebtoken::{encode, EncodingKey, Header};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::errors::AppError;
use crate::middleware::Claims;
use crate::models::{
    AuthResponse, LoginRequest, RegisterRequest, UpdateProfileRequest, User, UserResponse,
};

pub async fn register(
    pool: &PgPool,
    config: &AppConfig,
    req: RegisterRequest,
) -> Result<AuthResponse, AppError> {
    let username = req.username.trim().to_string();
    if username.is_empty() || username.len() > 100 {
        return Err(AppError::Validation("用户名不能为空且不超过100字符".to_string()));
    }
    if req.password.len() < 4 {
        return Err(AppError::Validation("密码至少4个字符".to_string()));
    }

    let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&username)
        .fetch_optional(pool)
        .await?;

    if existing.is_some() {
        return Err(AppError::BadRequest("该用户名已被注册".to_string()));
    }

    let password_hash = hash_password(&req.password)?;
    let user_id = Uuid::new_v4();
    let now = Utc::now();

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (id, email, password_hash, nickname, email_verified, verification_token, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, NULL, $5, $6)
         RETURNING *",
    )
    .bind(user_id)
    .bind(&username)
    .bind(&password_hash)
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
        .ok_or_else(|| AppError::Unauthorized("用户名或密码错误".to_string()))?;

    verify_password(&req.password, &user.password_hash)?;

    let token = generate_jwt(config, user.id)?;

    Ok(AuthResponse {
        token,
        user: UserResponse::from_user(&user),
    })
}

pub async fn update_profile(
    pool: &PgPool,
    config: &AppConfig,
    user_id: Uuid,
    req: UpdateProfileRequest,
) -> Result<AuthResponse, AppError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await?;

    // If changing password, verify current password
    let new_hash = if let Some(new_pw) = &req.new_password {
        if new_pw.len() < 4 {
            return Err(AppError::Validation("新密码至少4个字符".to_string()));
        }
        let current_pw = req.current_password.as_deref().unwrap_or("");
        verify_password(current_pw, &user.password_hash)?;
        Some(hash_password(new_pw)?)
    } else {
        None
    };

    // If changing username, check uniqueness
    let new_username = if let Some(uname) = &req.username {
        let trimmed = uname.trim().to_string();
        if trimmed.is_empty() || trimmed.len() > 100 {
            return Err(AppError::Validation("用户名不能为空且不超过100字符".to_string()));
        }
        if trimmed != user.email {
            let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1 AND id != $2")
                .bind(&trimmed)
                .bind(user_id)
                .fetch_optional(pool)
                .await?;
            if existing.is_some() {
                return Err(AppError::BadRequest("该用户名已被使用".to_string()));
            }
            Some(trimmed)
        } else {
            None
        }
    } else {
        None
    };

    let now = Utc::now();
    let updated_user = match (&new_username, &new_hash) {
        (Some(uname), Some(hash)) => {
            sqlx::query_as::<_, User>(
                "UPDATE users SET email = $1, nickname = $2, password_hash = $3, updated_at = $4 WHERE id = $5 RETURNING *",
            )
            .bind(uname)
            .bind(uname)
            .bind(hash)
            .bind(now)
            .bind(user_id)
            .fetch_one(pool)
            .await?
        }
        (Some(uname), None) => {
            sqlx::query_as::<_, User>(
                "UPDATE users SET email = $1, nickname = $2, updated_at = $3 WHERE id = $4 RETURNING *",
            )
            .bind(uname)
            .bind(uname)
            .bind(now)
            .bind(user_id)
            .fetch_one(pool)
            .await?
        }
        (None, Some(hash)) => {
            sqlx::query_as::<_, User>(
                "UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3 RETURNING *",
            )
            .bind(hash)
            .bind(now)
            .bind(user_id)
            .fetch_one(pool)
            .await?
        }
        (None, None) => user,
    };

    let token = generate_jwt(config, updated_user.id)?;

    Ok(AuthResponse {
        token,
        user: UserResponse::from_user(&updated_user),
    })
}

fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("Password hashing failed: {}", e)))
}

fn verify_password(password: &str, hash: &str) -> Result<(), AppError> {
    if hash.is_empty() {
        return Err(AppError::Unauthorized("用户名或密码错误".to_string()));
    }
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|_| AppError::Unauthorized("用户名或密码错误".to_string()))?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::Unauthorized("用户名或密码错误".to_string()))
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
