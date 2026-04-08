mod config;
mod db;
mod errors;
mod handlers;
mod middleware;
mod models;
mod services;

use std::sync::Arc;

use config::AppConfig;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = AppConfig::from_env();
    tracing::info!("Starting PenyCounts backend...");

    let pool = db::init_pool(&config.database_url).await;
    tracing::info!("Database connected");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run database migrations");
    tracing::info!("Migrations applied");

    let addr = format!("{}:{}", config.server_host, config.server_port);
    let config = Arc::new(config);

    let app = handlers::create_router(pool, config.clone());

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind address");

    tracing::info!("Server listening on {}", addr);

    axum::serve(listener, app)
        .await
        .expect("Server error");
}
