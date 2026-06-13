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
