use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{Category, CreateCategoryRequest, CreateSubcategoryRequest, Subcategory};

pub async fn get_all_categories(pool: &PgPool, user_id: Uuid) -> Result<Vec<Category>, AppError> {
    let categories = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE user_id IS NULL OR user_id = $1 ORDER BY type, sort_order, name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(categories)
}

pub async fn get_category(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
) -> Result<Category, AppError> {
    sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE id = $1 AND (user_id IS NULL OR user_id = $2)",
    )
    .bind(category_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Category not found".to_string()))
}

pub async fn create_category(
    pool: &PgPool,
    user_id: Uuid,
    req: CreateCategoryRequest,
) -> Result<Category, AppError> {
    if req.name.is_empty() {
        return Err(AppError::Validation(
            "Category name cannot be empty".to_string(),
        ));
    }

    let max_sort: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(sort_order) FROM categories WHERE (user_id IS NULL OR user_id = $1) AND type = $2",
    )
    .bind(user_id)
    .bind(&req.r#type)
    .fetch_one(pool)
    .await?;

    let category = sqlx::query_as::<_, Category>(
        "INSERT INTO categories (id, user_id, name, type, icon, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.r#type)
    .bind(&req.icon)
    .bind(max_sort.unwrap_or(0) + 1)
    .fetch_one(pool)
    .await?;

    Ok(category)
}

pub async fn update_category(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
    req: CreateCategoryRequest,
) -> Result<Category, AppError> {
    let existing = sqlx::query_as::<_, Category>("SELECT * FROM categories WHERE id = $1")
        .bind(category_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Category not found".to_string()))?;

    if existing.user_id.is_none() {
        return Err(AppError::Forbidden(
            "Cannot modify system default categories".to_string(),
        ));
    }

    if existing.user_id != Some(user_id) {
        return Err(AppError::Forbidden(
            "You can only edit your own categories".to_string(),
        ));
    }

    let category = sqlx::query_as::<_, Category>(
        "UPDATE categories SET name = $1, type = $2, icon = $3 WHERE id = $4 RETURNING *",
    )
    .bind(&req.name)
    .bind(&req.r#type)
    .bind(&req.icon)
    .bind(category_id)
    .fetch_one(pool)
    .await?;

    Ok(category)
}

pub async fn delete_category(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
) -> Result<(), AppError> {
    let existing = sqlx::query_as::<_, Category>("SELECT * FROM categories WHERE id = $1")
        .bind(category_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Category not found".to_string()))?;

    if existing.user_id.is_none() {
        return Err(AppError::Forbidden(
            "Cannot delete system default categories".to_string(),
        ));
    }

    if existing.user_id != Some(user_id) {
        return Err(AppError::Forbidden(
            "You can only delete your own categories".to_string(),
        ));
    }

    sqlx::query("DELETE FROM categories WHERE id = $1")
        .bind(category_id)
        .execute(pool)
        .await?;

    Ok(())
}

// ── Subcategories ────────────────────────────────────────────────────

pub async fn get_subcategories(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
) -> Result<Vec<Subcategory>, AppError> {
    let subs = sqlx::query_as::<_, Subcategory>(
        "SELECT * FROM subcategories
         WHERE category_id = $1 AND (user_id IS NULL OR user_id = $2)
         ORDER BY sort_order, name",
    )
    .bind(category_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(subs)
}

pub async fn create_subcategory(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
    req: CreateSubcategoryRequest,
) -> Result<Subcategory, AppError> {
    if req.name.is_empty() {
        return Err(AppError::Validation(
            "Subcategory name cannot be empty".to_string(),
        ));
    }

    let max_sort: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(sort_order) FROM subcategories WHERE category_id = $1 AND (user_id IS NULL OR user_id = $2)",
    )
    .bind(category_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let sub = sqlx::query_as::<_, Subcategory>(
        "INSERT INTO subcategories (id, category_id, user_id, name, icon, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(category_id)
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.icon)
    .bind(max_sort.unwrap_or(0) + 1)
    .fetch_one(pool)
    .await?;

    Ok(sub)
}

pub async fn update_subcategory(
    pool: &PgPool,
    user_id: Uuid,
    subcategory_id: Uuid,
    req: CreateSubcategoryRequest,
) -> Result<Subcategory, AppError> {
    let existing =
        sqlx::query_as::<_, Subcategory>("SELECT * FROM subcategories WHERE id = $1")
            .bind(subcategory_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("Subcategory not found".to_string()))?;

    if existing.user_id.is_none() {
        return Err(AppError::Forbidden(
            "Cannot modify system default subcategories".to_string(),
        ));
    }

    if existing.user_id != Some(user_id) {
        return Err(AppError::Forbidden(
            "You can only edit your own subcategories".to_string(),
        ));
    }

    let sub = sqlx::query_as::<_, Subcategory>(
        "UPDATE subcategories SET name = $1, icon = $2 WHERE id = $3 RETURNING *",
    )
    .bind(&req.name)
    .bind(&req.icon)
    .bind(subcategory_id)
    .fetch_one(pool)
    .await?;

    Ok(sub)
}

pub async fn delete_subcategory(
    pool: &PgPool,
    user_id: Uuid,
    subcategory_id: Uuid,
) -> Result<(), AppError> {
    let existing =
        sqlx::query_as::<_, Subcategory>("SELECT * FROM subcategories WHERE id = $1")
            .bind(subcategory_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("Subcategory not found".to_string()))?;

    if existing.user_id.is_none() {
        return Err(AppError::Forbidden(
            "Cannot delete system default subcategories".to_string(),
        ));
    }

    if existing.user_id != Some(user_id) {
        return Err(AppError::Forbidden(
            "You can only delete your own subcategories".to_string(),
        ));
    }

    sqlx::query("DELETE FROM subcategories WHERE id = $1")
        .bind(subcategory_id)
        .execute(pool)
        .await?;

    Ok(())
}
