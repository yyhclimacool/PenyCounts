use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{Category, CreateCategoryRequest, CreateSubcategoryRequest, Subcategory};
use crate::services;

pub async fn list_categories(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<Category>>, AppError> {
    let categories = services::category::get_all_categories(&state.pool, auth.user_id).await?;
    Ok(Json(categories))
}

pub async fn get_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Category>, AppError> {
    let category = services::category::get_category(&state.pool, auth.user_id, id).await?;
    Ok(Json(category))
}

pub async fn create_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateCategoryRequest>,
) -> Result<(StatusCode, Json<Category>), AppError> {
    let category =
        services::category::create_category(&state.pool, auth.user_id, req).await?;
    Ok((StatusCode::CREATED, Json(category)))
}

pub async fn update_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateCategoryRequest>,
) -> Result<Json<Category>, AppError> {
    let category =
        services::category::update_category(&state.pool, auth.user_id, id, req).await?;
    Ok(Json(category))
}

pub async fn delete_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    services::category::delete_category(&state.pool, auth.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Subcategories ────────────────────────────────────────────────────

pub async fn list_subcategories(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(category_id): Path<Uuid>,
) -> Result<Json<Vec<Subcategory>>, AppError> {
    let subs =
        services::category::get_subcategories(&state.pool, auth.user_id, category_id).await?;
    Ok(Json(subs))
}

pub async fn create_subcategory(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(category_id): Path<Uuid>,
    Json(req): Json<CreateSubcategoryRequest>,
) -> Result<(StatusCode, Json<Subcategory>), AppError> {
    let sub =
        services::category::create_subcategory(&state.pool, auth.user_id, category_id, req)
            .await?;
    Ok((StatusCode::CREATED, Json(sub)))
}

pub async fn update_subcategory(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateSubcategoryRequest>,
) -> Result<Json<Subcategory>, AppError> {
    let sub =
        services::category::update_subcategory(&state.pool, auth.user_id, id, req).await?;
    Ok(Json(sub))
}

pub async fn delete_subcategory(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    services::category::delete_subcategory(&state.pool, auth.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
