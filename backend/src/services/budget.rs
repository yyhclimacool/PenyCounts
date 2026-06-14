use chrono::{Datelike, Local};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{
    Budget, BudgetRequest, BudgetWithSpent, SavingsGoal, SavingsGoalRequest,
};

// ── Budgets ──────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct BudgetRow {
    id: Uuid,
    category_id: Option<Uuid>,
    category_name: Option<String>,
    category_icon: Option<String>,
    amount: Decimal,
    period: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// List budgets with the actual amount spent in the current period
/// (this month for `monthly`, this year for `yearly`).
pub async fn list_budgets(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<Vec<BudgetWithSpent>, AppError> {
    let rows = sqlx::query_as::<_, BudgetRow>(
        "SELECT b.id, b.category_id, c.name AS category_name, c.icon AS category_icon,
                b.amount, b.period, b.created_at
         FROM budgets b
         LEFT JOIN categories c ON b.category_id = c.id
         WHERE b.family_id = $1
         ORDER BY b.category_id NULLS FIRST, b.created_at",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;

    let now = Local::now().date_naive();
    let year = now.year();
    let month = now.month() as i32;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let monthly = r.period == "monthly";
        let spent: Decimal = sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions
             WHERE family_id = $1 AND type = 'expense'
               AND EXTRACT(YEAR FROM date)::int4 = $2
               AND ($3::int4 IS NULL OR EXTRACT(MONTH FROM date)::int4 = $3)
               AND ($4::uuid IS NULL OR category_id = $4)",
        )
        .bind(family_id)
        .bind(year)
        .bind(if monthly { Some(month) } else { None })
        .bind(r.category_id)
        .fetch_one(pool)
        .await?;

        out.push(BudgetWithSpent {
            id: r.id,
            category_id: r.category_id,
            category_name: r.category_name,
            category_icon: r.category_icon,
            amount: r.amount,
            period: r.period,
            spent,
            created_at: r.created_at,
        });
    }
    Ok(out)
}

fn validate_period(period: &str) -> Result<(), AppError> {
    if period != "monthly" && period != "yearly" {
        return Err(AppError::Validation(
            "period must be 'monthly' or 'yearly'".to_string(),
        ));
    }
    Ok(())
}

pub async fn create_budget(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    req: BudgetRequest,
) -> Result<Budget, AppError> {
    validate_period(&req.period)?;
    if req.amount < Decimal::ZERO {
        return Err(AppError::Validation("amount must be >= 0".to_string()));
    }

    let budget = sqlx::query_as::<_, Budget>(
        "INSERT INTO budgets (id, family_id, user_id, category_id, amount, period)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(family_id)
    .bind(user_id)
    .bind(req.category_id)
    .bind(req.amount)
    .bind(&req.period)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Validation("该分类的预算已存在".to_string()))?;

    Ok(budget)
}

pub async fn update_budget(
    pool: &PgPool,
    family_id: Uuid,
    budget_id: Uuid,
    req: BudgetRequest,
) -> Result<Budget, AppError> {
    validate_period(&req.period)?;
    if req.amount < Decimal::ZERO {
        return Err(AppError::Validation("amount must be >= 0".to_string()));
    }

    let budget = sqlx::query_as::<_, Budget>(
        "UPDATE budgets SET amount = $1, period = $2, category_id = $3
         WHERE id = $4 AND family_id = $5
         RETURNING *",
    )
    .bind(req.amount)
    .bind(&req.period)
    .bind(req.category_id)
    .bind(budget_id)
    .bind(family_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Budget not found".to_string()))?;

    Ok(budget)
}

pub async fn delete_budget(
    pool: &PgPool,
    family_id: Uuid,
    budget_id: Uuid,
) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM budgets WHERE id = $1 AND family_id = $2")
        .bind(budget_id)
        .bind(family_id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Budget not found".to_string()));
    }
    Ok(())
}

// ── Savings goals ────────────────────────────────────────────────────

pub async fn list_goals(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<Vec<SavingsGoal>, AppError> {
    let goals = sqlx::query_as::<_, SavingsGoal>(
        "SELECT * FROM savings_goals WHERE family_id = $1 ORDER BY created_at",
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;
    Ok(goals)
}

fn validate_goal(req: &SavingsGoalRequest) -> Result<(), AppError> {
    if req.name.trim().is_empty() {
        return Err(AppError::Validation("目标名称不能为空".to_string()));
    }
    if req.target_amount <= Decimal::ZERO {
        return Err(AppError::Validation("目标金额必须大于 0".to_string()));
    }
    if req.current_amount < Decimal::ZERO {
        return Err(AppError::Validation("已存金额不能为负".to_string()));
    }
    Ok(())
}

pub async fn create_goal(
    pool: &PgPool,
    user_id: Uuid,
    family_id: Uuid,
    req: SavingsGoalRequest,
) -> Result<SavingsGoal, AppError> {
    validate_goal(&req)?;
    let icon = req.icon.filter(|s| !s.is_empty()).unwrap_or_else(|| "🎯".to_string());

    let goal = sqlx::query_as::<_, SavingsGoal>(
        "INSERT INTO savings_goals
            (id, family_id, user_id, name, target_amount, current_amount, deadline, icon)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(family_id)
    .bind(user_id)
    .bind(req.name.trim())
    .bind(req.target_amount)
    .bind(req.current_amount)
    .bind(req.deadline)
    .bind(&icon)
    .fetch_one(pool)
    .await?;
    Ok(goal)
}

pub async fn update_goal(
    pool: &PgPool,
    family_id: Uuid,
    goal_id: Uuid,
    req: SavingsGoalRequest,
) -> Result<SavingsGoal, AppError> {
    validate_goal(&req)?;
    let icon = req.icon.filter(|s| !s.is_empty()).unwrap_or_else(|| "🎯".to_string());

    let goal = sqlx::query_as::<_, SavingsGoal>(
        "UPDATE savings_goals
         SET name = $1, target_amount = $2, current_amount = $3, deadline = $4, icon = $5
         WHERE id = $6 AND family_id = $7
         RETURNING *",
    )
    .bind(req.name.trim())
    .bind(req.target_amount)
    .bind(req.current_amount)
    .bind(req.deadline)
    .bind(&icon)
    .bind(goal_id)
    .bind(family_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Savings goal not found".to_string()))?;
    Ok(goal)
}

pub async fn delete_goal(
    pool: &PgPool,
    family_id: Uuid,
    goal_id: Uuid,
) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM savings_goals WHERE id = $1 AND family_id = $2")
        .bind(goal_id)
        .bind(family_id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Savings goal not found".to_string()));
    }
    Ok(())
}
