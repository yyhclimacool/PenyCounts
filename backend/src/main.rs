mod config;
mod db;
mod errors;
mod handlers;
mod middleware;
mod models;
mod services;

use std::sync::Arc;

use config::AppConfig;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("debug,tower_http=debug,sqlx=warn,hyper=warn,reqwest=warn"));

    let log_dir = std::path::Path::new("logs");
    std::fs::create_dir_all(log_dir).expect("Failed to create logs directory");

    let file_appender = tracing_appender::rolling::daily(log_dir, "penycounts.log");
    let (file_writer, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(
            fmt::layer()
                .with_target(true)
                .with_thread_ids(false)
                .with_file(false)
                .with_line_number(false),
        )
        .with(
            fmt::layer()
                .with_target(true)
                .with_thread_ids(false)
                .with_file(false)
                .with_line_number(false)
                .with_ansi(false)
                .with_writer(file_writer),
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
