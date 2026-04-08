use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use jsonwebtoken::{encode, EncodingKey, Header};
use lettre::{
    message::header::ContentType, transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
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
) -> Result<UserResponse, AppError> {
    if req.email.is_empty() || !req.email.contains('@') {
        return Err(AppError::Validation("Invalid email address".to_string()));
    }
    if req.password.len() < 6 {
        return Err(AppError::Validation(
            "Password must be at least 6 characters".to_string(),
        ));
    }

    let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_optional(pool)
        .await?;

    if existing.is_some() {
        return Err(AppError::BadRequest(
            "Email already registered".to_string(),
        ));
    }

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(req.password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hashing failed: {}", e)))?
        .to_string();

    let verification_token: String = rand::Rng::sample_iter(rand::thread_rng(), &rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let user_id = Uuid::new_v4();
    let now = Utc::now();

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (id, email, password_hash, nickname, email_verified, verification_token, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, $5, $6, $7)
         RETURNING *",
    )
    .bind(user_id)
    .bind(&req.email)
    .bind(&password_hash)
    .bind(&req.nickname)
    .bind(&verification_token)
    .bind(now)
    .bind(now)
    .fetch_one(pool)
    .await?;

    if let Err(e) = send_verification_email(config, &req.email, &verification_token).await {
        tracing::error!("Failed to send verification email: {}", e);
    }

    Ok(UserResponse::from_user(&user))
}

pub async fn verify_email(pool: &PgPool, token: &str) -> Result<(), AppError> {
    let result = sqlx::query(
        "UPDATE users SET email_verified = true, verification_token = NULL, updated_at = $1
         WHERE verification_token = $2 AND email_verified = false",
    )
    .bind(Utc::now())
    .bind(token)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Invalid or expired verification token".to_string(),
        ));
    }

    Ok(())
}

pub async fn login(
    pool: &PgPool,
    config: &AppConfig,
    req: LoginRequest,
) -> Result<AuthResponse, AppError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid email or password".to_string()))?;

    let parsed_hash = PasswordHash::new(&user.password_hash)
        .map_err(|e| AppError::Internal(format!("Password hash parse error: {}", e)))?;

    Argon2::default()
        .verify_password(req.password.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::Unauthorized("Invalid email or password".to_string()))?;

    if !user.email_verified {
        return Err(AppError::Forbidden(
            "Please verify your email before logging in".to_string(),
        ));
    }

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

pub async fn forgot_password(
    pool: &PgPool,
    config: &AppConfig,
    email: &str,
) -> Result<(), AppError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(email)
        .fetch_optional(pool)
        .await?;

    if let Some(_user) = user {
        let reset_token: String = rand::Rng::sample_iter(rand::thread_rng(), &rand::distributions::Alphanumeric)
            .take(32)
            .map(char::from)
            .collect();

        sqlx::query(
            "UPDATE users SET verification_token = $1, updated_at = $2 WHERE email = $3",
        )
        .bind(&reset_token)
        .bind(Utc::now())
        .bind(email)
        .execute(pool)
        .await?;

        if let Err(e) = send_reset_email(config, email, &reset_token).await {
            tracing::error!("Failed to send reset email: {}", e);
        }
    }

    Ok(())
}

pub async fn reset_password(
    pool: &PgPool,
    token: &str,
    new_password: &str,
) -> Result<(), AppError> {
    if new_password.len() < 6 {
        return Err(AppError::Validation(
            "Password must be at least 6 characters".to_string(),
        ));
    }

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(new_password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hashing failed: {}", e)))?
        .to_string();

    let result = sqlx::query(
        "UPDATE users SET password_hash = $1, verification_token = NULL, updated_at = $2
         WHERE verification_token = $3",
    )
    .bind(&password_hash)
    .bind(Utc::now())
    .bind(token)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Invalid or expired reset token".to_string(),
        ));
    }

    Ok(())
}

async fn send_verification_email(
    config: &AppConfig,
    to_email: &str,
    token: &str,
) -> Result<(), AppError> {
    let verify_url = format!("{}/verify-email?token={}", config.frontend_url, token);

    let body = format!(
        "<h2>Welcome to PenyCounts!</h2>\
         <p>Please click the link below to verify your email address:</p>\
         <p><a href=\"{url}\">{url}</a></p>\
         <p>If you didn't create this account, you can safely ignore this email.</p>",
        url = verify_url
    );

    let email = Message::builder()
        .from(
            config
                .smtp_from
                .parse()
                .map_err(|_| AppError::Internal("Invalid SMTP from address".to_string()))?,
        )
        .to(to_email
            .parse()
            .map_err(|_| AppError::Internal("Invalid recipient address".to_string()))?)
        .subject("PenyCounts - Verify Your Email")
        .header(ContentType::TEXT_HTML)
        .body(body)
        .map_err(|e| AppError::Internal(format!("Failed to build email: {}", e)))?;

    let creds = Credentials::new(config.smtp_username.clone(), config.smtp_password.clone());

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)
        .map_err(|e| AppError::Internal(format!("SMTP relay error: {}", e)))?
        .credentials(creds)
        .port(config.smtp_port)
        .build();

    mailer
        .send(email)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to send email: {}", e)))?;

    Ok(())
}

async fn send_reset_email(
    config: &AppConfig,
    to_email: &str,
    token: &str,
) -> Result<(), AppError> {
    let reset_url = format!("{}/reset-password?token={}", config.frontend_url, token);

    let body = format!(
        "<h2>Password Reset</h2>\
         <p>Click the link below to reset your password:</p>\
         <p><a href=\"{url}\">{url}</a></p>\
         <p>If you didn't request this, you can safely ignore this email.</p>",
        url = reset_url
    );

    let email = Message::builder()
        .from(
            config
                .smtp_from
                .parse()
                .map_err(|_| AppError::Internal("Invalid SMTP from address".to_string()))?,
        )
        .to(to_email
            .parse()
            .map_err(|_| AppError::Internal("Invalid recipient address".to_string()))?)
        .subject("PenyCounts - Password Reset")
        .header(ContentType::TEXT_HTML)
        .body(body)
        .map_err(|e| AppError::Internal(format!("Failed to build email: {}", e)))?;

    let creds = Credentials::new(config.smtp_username.clone(), config.smtp_password.clone());

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)
        .map_err(|e| AppError::Internal(format!("SMTP relay error: {}", e)))?
        .credentials(creds)
        .port(config.smtp_port)
        .build();

    mailer
        .send(email)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to send email: {}", e)))?;

    Ok(())
}
