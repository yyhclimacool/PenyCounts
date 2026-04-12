pub mod ai;
pub mod auth;
pub mod categories;
pub mod members;
pub mod social_gifts;
pub mod stats;
pub mod transactions;

use std::sync::Arc;

use axum::{
    http::{header, HeaderValue, Method},
    Router,
};
use sqlx::PgPool;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::{AppConfig, AppState};

pub fn create_router(pool: PgPool, config: Arc<AppConfig>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(
            config
                .frontend_url
                .parse::<HeaderValue>()
                .expect("Invalid FRONTEND_URL for CORS"),
        )
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .allow_credentials(true);

    let state = AppState { pool, config };

    Router::new()
        // Auth (public)
        .route("/api/auth/register", axum::routing::post(auth::register))
        .route("/api/auth/login", axum::routing::post(auth::login))
        .route(
            "/api/auth/verify-email",
            axum::routing::get(auth::verify_email),
        )
        .route(
            "/api/auth/forgot-password",
            axum::routing::post(auth::forgot_password),
        )
        .route(
            "/api/auth/reset-password",
            axum::routing::post(auth::reset_password),
        )
        // Categories
        .route(
            "/api/categories",
            axum::routing::get(categories::list_categories)
                .post(categories::create_category),
        )
        .route(
            "/api/categories/{id}",
            axum::routing::get(categories::get_category)
                .put(categories::update_category)
                .delete(categories::delete_category),
        )
        .route(
            "/api/categories/{category_id}/subcategories",
            axum::routing::get(categories::list_subcategories)
                .post(categories::create_subcategory),
        )
        .route(
            "/api/subcategories/{id}",
            axum::routing::put(categories::update_subcategory)
                .delete(categories::delete_subcategory),
        )
        // Transactions
        .route(
            "/api/transactions",
            axum::routing::get(transactions::list_transactions)
                .post(transactions::create_transaction),
        )
        .route(
            "/api/transactions/{id}",
            axum::routing::get(transactions::get_transaction)
                .put(transactions::update_transaction)
                .delete(transactions::delete_transaction),
        )
        .route(
            "/api/transactions/{id}/members",
            axum::routing::get(transactions::get_transaction_members),
        )
        // Members
        .route(
            "/api/members",
            axum::routing::get(members::list_members).post(members::create_member),
        )
        .route(
            "/api/members/{id}",
            axum::routing::get(members::get_member)
                .put(members::update_member)
                .delete(members::delete_member),
        )
        // Social gifts
        .route(
            "/api/social-gifts",
            axum::routing::get(social_gifts::list_social_gifts)
                .post(social_gifts::create_social_gift),
        )
        .route(
            "/api/social-gifts/{id}",
            axum::routing::get(social_gifts::get_social_gift)
                .put(social_gifts::update_social_gift)
                .delete(social_gifts::delete_social_gift),
        )
        // Stats
        .route(
            "/api/stats/monthly-trend",
            axum::routing::get(stats::monthly_trend),
        )
        .route(
            "/api/stats/monthly-detail",
            axum::routing::get(stats::monthly_detail),
        )
        .route(
            "/api/stats/category-breakdown",
            axum::routing::get(stats::category_breakdown),
        )
        .route(
            "/api/stats/member-breakdown",
            axum::routing::get(stats::member_breakdown),
        )
        .route(
            "/api/stats/social-summary",
            axum::routing::get(stats::social_summary),
        )
        // AI
        .route(
            "/api/ai/config",
            axum::routing::get(ai::get_active_config).put(ai::upsert_config),
        )
        .route(
            "/api/ai/configs",
            axum::routing::get(ai::list_configs).post(ai::create_config),
        )
        .route(
            "/api/ai/configs/{id}",
            axum::routing::put(ai::update_config).delete(ai::delete_config),
        )
        .route(
            "/api/ai/configs/{id}/activate",
            axum::routing::post(ai::activate_config),
        )
        .route("/api/ai/chat", axum::routing::post(ai::chat))
        .route(
            "/api/ai/chat/history",
            axum::routing::get(ai::chat_history).delete(ai::clear_history),
        )
        // Health
        .route("/api/health", axum::routing::get(health))
        .layer(CompressionLayer::new().br(true).gzip(true))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}
