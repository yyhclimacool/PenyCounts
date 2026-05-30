use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::config::AppState;
use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::models::{Category, CategoryWithSubs, CreateCategoryRequest, CreateSubcategoryRequest, Subcategory};
use crate::services;

pub async fn list_categories(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<CategoryWithSubs>>, AppError> {
    tracing::debug!(user_id = %auth.family_id, "list_categories: received request");
    let categories = services::category::get_all_categories_with_subs(&state.pool, auth.family_id).await?;
    tracing::debug!(user_id = %auth.family_id, count = categories.len(), "list_categories: returning categories");
    Ok(Json(categories))
}

pub async fn get_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Category>, AppError> {
    tracing::debug!(user_id = %auth.family_id, category_id = %id, "get_category: received request");
    let category = services::category::get_category(&state.pool, auth.family_id, id).await?;
    tracing::debug!(category_id = %id, name = %category.name, "get_category: returning category");
    Ok(Json(category))
}

pub async fn create_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateCategoryRequest>,
) -> Result<(StatusCode, Json<Category>), AppError> {
    tracing::debug!(user_id = %auth.family_id, ?req, "create_category: received request");
    let category =
        services::category::create_category(&state.pool, auth.family_id, req).await?;
    tracing::info!(category_id = %category.id, name = %category.name, "create_category: created successfully");
    Ok((StatusCode::CREATED, Json(category)))
}

pub async fn update_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateCategoryRequest>,
) -> Result<Json<Category>, AppError> {
    tracing::debug!(user_id = %auth.family_id, category_id = %id, ?req, "update_category: received request");
    let category =
        services::category::update_category(&state.pool, auth.family_id, id, req).await?;
    tracing::info!(category_id = %category.id, name = %category.name, "update_category: updated successfully");
    Ok(Json(category))
}

pub async fn delete_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    tracing::debug!(user_id = %auth.family_id, category_id = %id, "delete_category: received request");
    services::category::delete_category(&state.pool, auth.family_id, id).await?;
    tracing::info!(category_id = %id, "delete_category: deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}

// ── Subcategories ────────────────────────────────────────────────────

pub async fn list_subcategories(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(category_id): Path<Uuid>,
) -> Result<Json<Vec<Subcategory>>, AppError> {
    tracing::debug!(user_id = %auth.family_id, category_id = %category_id, "list_subcategories: received request");
    let subs =
        services::category::get_subcategories(&state.pool, auth.family_id, category_id).await?;
    tracing::debug!(category_id = %category_id, count = subs.len(), "list_subcategories: returning subcategories");
    Ok(Json(subs))
}

pub async fn create_subcategory(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(category_id): Path<Uuid>,
    Json(req): Json<CreateSubcategoryRequest>,
) -> Result<(StatusCode, Json<Subcategory>), AppError> {
    tracing::debug!(user_id = %auth.family_id, category_id = %category_id, ?req, "create_subcategory: received request");
    let sub =
        services::category::create_subcategory(&state.pool, auth.family_id, category_id, req)
            .await?;
    tracing::info!(sub_id = %sub.id, name = %sub.name, "create_subcategory: created successfully");
    Ok((StatusCode::CREATED, Json(sub)))
}

pub async fn update_subcategory(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateSubcategoryRequest>,
) -> Result<Json<Subcategory>, AppError> {
    tracing::debug!(user_id = %auth.family_id, sub_id = %id, ?req, "update_subcategory: received request");
    let sub =
        services::category::update_subcategory(&state.pool, auth.family_id, id, req).await?;
    tracing::info!(sub_id = %sub.id, name = %sub.name, "update_subcategory: updated successfully");
    Ok(Json(sub))
}

pub async fn delete_subcategory(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    tracing::debug!(user_id = %auth.family_id, sub_id = %id, "delete_subcategory: received request");
    services::category::delete_subcategory(&state.pool, auth.family_id, id).await?;
    tracing::info!(sub_id = %id, "delete_subcategory: deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}
