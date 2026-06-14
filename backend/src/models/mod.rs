use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Database models ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub nickname: String,
    pub email_verified: bool,
    pub verification_token: Option<String>,
    pub avatar_url: Option<String>,
    pub default_family_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Family {
    pub id: Uuid,
    pub name: String,
    pub invite_code: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FamilyMember {
    pub id: Uuid,
    pub family_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Category {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub family_id: Option<Uuid>,
    pub name: String,
    pub r#type: String,
    pub icon: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Subcategory {
    pub id: Uuid,
    pub category_id: Uuid,
    pub user_id: Option<Uuid>,
    pub family_id: Option<Uuid>,
    pub name: String,
    pub icon: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoryWithSubs {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub family_id: Option<Uuid>,
    pub name: String,
    pub r#type: String,
    pub icon: String,
    pub sort_order: i32,
    pub subcategories: Vec<Subcategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Transaction {
    pub id: Uuid,
    pub user_id: Uuid,
    pub family_id: Uuid,
    pub category_id: Uuid,
    pub subcategory_id: Option<Uuid>,
    pub r#type: String,
    pub amount: Decimal,
    pub currency: String,
    pub date: NaiveDate,
    pub time: NaiveTime,
    pub location: Option<String>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransactionWithMembers {
    #[serde(flatten)]
    pub transaction: Transaction,
    pub members: Vec<TransactionMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TransactionMember {
    pub id: Uuid,
    pub transaction_id: Uuid,
    pub member_name: String,
    pub share_amount: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Member {
    pub id: Uuid,
    pub user_id: Uuid,
    pub family_id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SocialGift {
    pub id: Uuid,
    pub user_id: Uuid,
    pub family_id: Uuid,
    pub r#type: String,
    pub person_name: String,
    pub relation: Option<String>,
    pub occasion: String,
    pub amount: Decimal,
    pub currency: String,
    pub date: NaiveDate,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LlmConfig {
    pub id: Uuid,
    pub user_id: Uuid,
    pub family_id: Uuid,
    pub provider: String,
    pub api_url: String,
    pub api_key: Option<String>,
    pub model_name: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ChatMessage {
    pub id: Uuid,
    pub user_id: Uuid,
    pub family_id: Uuid,
    pub role: String,
    pub content: String,
    /// Serialized OpenAI `tool_calls` array for assistant turns that invoked tools.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<String>,
    /// Set on `role = 'tool'` rows, linking the result back to its tool call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ── Request DTOs ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub username: Option<String>,
    pub current_password: Option<String>,
    pub new_password: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCategoryRequest {
    pub name: String,
    pub r#type: String,
    pub icon: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateSubcategoryRequest {
    pub name: String,
    pub icon: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateTransactionRequest {
    pub category_id: Uuid,
    pub subcategory_id: Option<Uuid>,
    pub r#type: String,
    pub amount: Decimal,
    pub currency: String,
    pub date: NaiveDate,
    pub time: NaiveTime,
    pub location: Option<String>,
    pub note: Option<String>,
    pub members: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSocialGiftRequest {
    pub r#type: String,
    pub person_name: String,
    pub relation: Option<String>,
    pub occasion: String,
    pub amount: Decimal,
    pub currency: String,
    pub date: NaiveDate,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateMemberRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct LlmConfigRequest {
    pub provider: String,
    pub api_url: String,
    pub api_key: Option<String>,
    pub model_name: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub message: String,
}

fn default_report_period() -> String {
    "monthly".to_string()
}

#[derive(Debug, Deserialize)]
pub struct ReportRequest {
    #[serde(default = "default_report_period")]
    pub period: String,
    pub year: i32,
    #[serde(default)]
    pub month: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateFamilyRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct JoinFamilyRequest {
    pub invite_code: String,
}

#[derive(Debug, Deserialize)]
pub struct SwitchFamilyRequest {
    pub family_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct ImportCsvRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct TransactionFilter {
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub category_id: Option<Uuid>,
    pub subcategory_id: Option<Uuid>,
    pub r#type: Option<String>,
    pub search: Option<String>,
    pub member_name: Option<String>,
    pub min_amount: Option<Decimal>,
    pub max_amount: Option<Decimal>,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SocialGiftFilter {
    pub r#type: Option<String>,
    pub person_name: Option<String>,
    pub year: Option<i32>,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct StatsYearQuery {
    pub year: i32,
}

#[derive(Debug, Deserialize)]
pub struct StatsYearMonthQuery {
    pub year: i32,
    pub month: u32,
}

#[derive(Debug, Deserialize)]
pub struct StatsBreakdownQuery {
    pub year: i32,
    pub month: Option<u32>,
    pub r#type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StatsMemberQuery {
    pub year: i32,
    pub month: Option<u32>,
    pub r#type: Option<String>,
}

// ── Response DTOs ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub username: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub default_family_id: Option<Uuid>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FamilyResponse {
    pub id: Uuid,
    pub name: String,
    pub invite_code: String,
    pub role: String,
    pub member_count: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct FamilyDetailResponse {
    pub id: Uuid,
    pub name: String,
    pub invite_code: String,
    pub members: Vec<FamilyMemberInfo>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FamilyMemberInfo {
    pub user_id: Uuid,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: i64,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MonthlyTrendItem {
    pub month: i32,
    pub income: Decimal,
    pub expense: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CategoryBreakdown {
    pub category_id: Uuid,
    pub category_name: String,
    pub icon: String,
    pub total: Decimal,
    pub percentage: f64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SubcategoryBreakdown {
    pub category_id: Uuid,
    pub category_name: String,
    pub subcategory_id: Option<Uuid>,
    pub subcategory_name: Option<String>,
    pub total: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MemberBreakdown {
    pub member_name: String,
    pub total: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SocialSummary {
    pub person_name: String,
    pub given: Decimal,
    pub received: Decimal,
    pub net: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DailyTrendItem {
    pub day: i32,
    pub income: Decimal,
    pub expense: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DailyHeatmapItem {
    pub date: chrono::NaiveDate,
    pub income: Decimal,
    pub expense: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct YearlyTrendItem {
    pub year: i32,
    pub income: Decimal,
    pub expense: Decimal,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

// ── Insights (home dashboard narrative) ──────────────────────────────

/// Headline numbers for the current real-world month.
#[derive(Debug, Serialize)]
pub struct InsightOverview {
    pub year: i32,
    pub month: i32,
    pub month_income: Decimal,
    pub month_expense: Decimal,
    pub month_net: Decimal,
    pub last_month_expense: Decimal,
    pub expense_mom: Option<f64>,
    pub projected_expense: Decimal,
    pub days_elapsed: i32,
    pub days_in_month: i32,
    pub days_since_last_txn: Option<i32>,
    pub top_category: Option<String>,
    pub top_category_icon: Option<String>,
    pub top_category_amount: Decimal,
}

/// A single human-readable insight, already phrased in natural language by the
/// rule engine. `kind` drives the accent color; `icon` is a hint key the
/// frontend maps to a Lucide icon.
#[derive(Debug, Serialize)]
pub struct InsightCard {
    pub id: String,
    pub kind: String,
    pub icon: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Serialize)]
pub struct InsightsResponse {
    pub overview: InsightOverview,
    pub cards: Vec<InsightCard>,
}

// ── Budgets & savings goals ──────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Budget {
    pub id: Uuid,
    pub family_id: Uuid,
    pub user_id: Uuid,
    pub category_id: Option<Uuid>,
    pub amount: Decimal,
    pub period: String,
    pub created_at: DateTime<Utc>,
}

/// A budget enriched with the actual amount spent in the current period.
#[derive(Debug, Serialize)]
pub struct BudgetWithSpent {
    pub id: Uuid,
    pub category_id: Option<Uuid>,
    pub category_name: Option<String>,
    pub category_icon: Option<String>,
    pub amount: Decimal,
    pub period: String,
    pub spent: Decimal,
    pub created_at: DateTime<Utc>,
}

fn default_budget_period() -> String {
    "monthly".to_string()
}

#[derive(Debug, Deserialize)]
pub struct BudgetRequest {
    #[serde(default)]
    pub category_id: Option<Uuid>,
    pub amount: Decimal,
    #[serde(default = "default_budget_period")]
    pub period: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SavingsGoal {
    pub id: Uuid,
    pub family_id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub target_amount: Decimal,
    pub current_amount: Decimal,
    pub deadline: Option<NaiveDate>,
    pub icon: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SavingsGoalRequest {
    pub name: String,
    pub target_amount: Decimal,
    #[serde(default)]
    pub current_amount: Decimal,
    #[serde(default)]
    pub deadline: Option<NaiveDate>,
    #[serde(default)]
    pub icon: Option<String>,
}

// ── Settings import/export (JSON) ────────────────────────────────────
//
// A single, version-tagged envelope that aggregates a user's configurable
// data into one JSON document. Every section is optional so the format stays
// backward/forward compatible: importing an older file simply skips absent
// sections, and adding a new feature only requires adding a new optional
// field here (plus its handling in `services::settings`).

/// Bump whenever the export shape changes in a breaking way.
pub const SETTINGS_EXPORT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub struct SettingsExport {
    pub version: u32,
    #[serde(default)]
    pub app: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exported_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<UserSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<FamilySettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_config: Option<LlmConfigSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<CategorySettings>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FamilySettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmConfigSettings {
    pub provider: String,
    pub api_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    pub model_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CategorySettings {
    pub name: String,
    pub r#type: String,
    pub icon: String,
    #[serde(default)]
    pub subcategories: Vec<SubcategorySettings>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubcategorySettings {
    pub name: String,
    pub icon: String,
}

#[derive(Debug, Serialize)]
pub struct SettingsImportResult {
    /// Human-readable list of sections that were applied.
    pub applied: Vec<String>,
    /// Sections that were present but skipped (with reason).
    pub skipped: Vec<String>,
    /// Refreshed user, so the client can update avatar/nickname immediately.
    pub user: UserResponse,
}

impl UserResponse {
    pub fn from_user(user: &User) -> Self {
        Self {
            id: user.id,
            username: user.email.clone(),
            nickname: user.nickname.clone(),
            avatar_url: user.avatar_url.clone(),
            default_family_id: user.default_family_id,
        }
    }
}

// ── OCR (photo bookkeeping) ──────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct OcrAvailability {
    pub available: bool,
    pub model_name: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct OcrResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<String>,
    /// "income" | "expense"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    /// YYYY-MM-DD
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subcategory_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merchant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

// ── Streak / gamification ────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct DayCount {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct Achievement {
    pub id: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub unlocked: bool,
    /// 0.0..=1.0 progress toward unlocking.
    pub progress: f64,
}

#[derive(Debug, Serialize)]
pub struct StreakResponse {
    pub current_streak: i64,
    pub longest_streak: i64,
    /// Distinct days (all-time) with at least one transaction.
    pub total_active_days: i64,
    pub total_transactions: i64,
    pub today_logged: bool,
    /// Daily counts for the recent window (ascending by date), for the heatmap.
    pub daily: Vec<DayCount>,
    pub achievements: Vec<Achievement>,
}
