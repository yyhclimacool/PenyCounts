export interface User {
  id: string;
  username: string;
  nickname: string;
  avatar_url?: string | null;
  default_family_id?: string | null;
}

export interface Family {
  id: string;
  name: string;
  invite_code: string;
  role: string;
  member_count: number;
  created_at: string;
}

export interface FamilyDetail {
  id: string;
  name: string;
  invite_code: string;
  members: FamilyMemberInfo[];
}

export interface FamilyMemberInfo {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Category {
  id: string;
  user_id: string | null;
  name: string;
  type: 'income' | 'expense';
  icon: string;
  sort_order: number;
  subcategories?: Subcategory[];
}

export interface Subcategory {
  id: string;
  category_id: string;
  user_id: string | null;
  name: string;
  icon: string;
  sort_order: number;
}

export interface Transaction {
  id: string;
  user_id: string;
  category_id: string;
  subcategory_id: string | null;
  type: 'income' | 'expense';
  amount: string;
  currency: string;
  date: string;
  time: string;
  location: string | null;
  note: string | null;
  created_at: string;
  category?: Category;
  subcategory?: Subcategory;
  members?: TransactionMember[];
}

export interface TransactionMember {
  id: string;
  transaction_id: string;
  member_name: string;
  share_amount: string;
}

export interface Member {
  id: string;
  user_id: string;
  name: string;
}

export interface SocialGift {
  id: string;
  user_id: string;
  type: 'give' | 'receive';
  person_name: string;
  relation: string | null;
  occasion: string;
  amount: string;
  currency: string;
  date: string;
  note: string | null;
  created_at: string;
}

export interface LlmConfig {
  id: string;
  provider: string;
  api_url: string;
  api_key: string | null;
  model_name: string;
  is_active: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface MonthlyTrend {
  month: number;
  income: string;
  expense: string;
}

export interface CategoryBreakdown {
  category_id: string;
  category_name: string;
  icon: string;
  total: string;
  percentage: number;
}

export interface SubcategoryBreakdown {
  category_id: string;
  category_name: string;
  subcategory_id: string | null;
  subcategory_name: string | null;
  total: string;
}

export interface DailyHeatmap {
  date: string;
  income: string;
  expense: string;
}

export interface MemberBreakdown {
  member_name: string;
  total: string;
}

export interface DailyTrend {
  day: number;
  income: string;
  expense: string;
}

export interface YearlyTrend {
  year: number;
  income: string;
  expense: string;
}

export interface SocialSummary {
  person_name: string;
  given: string;
  received: string;
  net: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

// ── Insights (home dashboard) ────────────────────────────────────────

export interface InsightOverview {
  year: number;
  month: number;
  month_income: string;
  month_expense: string;
  month_net: string;
  last_month_expense: string;
  expense_mom: number | null;
  projected_expense: string;
  days_elapsed: number;
  days_in_month: number;
  days_since_last_txn: number | null;
  top_category: string | null;
  top_category_icon: string | null;
  top_category_amount: string;
}

export type InsightKind = 'info' | 'warning' | 'success' | 'tip';

export interface InsightCard {
  id: string;
  kind: InsightKind;
  icon: string;
  title: string;
  body: string;
}

export interface InsightsResponse {
  overview: InsightOverview;
  cards: InsightCard[];
}

// ── Budgets & savings goals ──────────────────────────────────────────

// ── OCR (photo bookkeeping) ──────────────────────────────────────────
export interface OcrAvailability {
  available: boolean;
  model_name: string;
}

export interface OcrResult {
  amount?: string;
  type?: 'income' | 'expense';
  date?: string;
  category_name?: string;
  subcategory_name?: string;
  merchant?: string;
  note?: string;
}

// ── Streak / gamification ────────────────────────────────────────────
export interface DayCount {
  date: string;
  count: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  progress: number;
}

export interface StreakResponse {
  current_streak: number;
  longest_streak: number;
  total_active_days: number;
  total_transactions: number;
  today_logged: boolean;
  daily: DayCount[];
  achievements: Achievement[];
}

export type BudgetPeriod = 'monthly' | 'yearly';

export interface BudgetWithSpent {
  id: string;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  amount: string;
  period: BudgetPeriod;
  spent: string;
  created_at: string;
}

export interface BudgetRequest {
  category_id?: string | null;
  amount: string;
  period: BudgetPeriod;
}

export interface SavingsGoal {
  id: string;
  family_id: string;
  user_id: string;
  name: string;
  target_amount: string;
  current_amount: string;
  deadline: string | null;
  icon: string;
  created_at: string;
}

export interface SavingsGoalRequest {
  name: string;
  target_amount: string;
  current_amount: string;
  deadline?: string | null;
  icon?: string;
}

// ── Settings import/export (JSON) ────────────────────────────────────
// A versioned envelope aggregating the user's configurable data. Every
// section is optional so the format stays backward/forward compatible —
// new features only add an optional field here. `appearance` is handled
// purely on the client (theme lives in localStorage, not the backend).

export interface SettingsExport {
  version: number;
  app?: string;
  exported_at?: string;
  user?: {
    nickname?: string;
    avatar_url?: string | null;
  };
  family?: {
    name?: string;
  };
  llm_config?: {
    provider: string;
    api_url: string;
    api_key?: string | null;
    model_name: string;
  } | null;
  members?: string[];
  categories?: {
    name: string;
    type: string;
    icon: string;
    subcategories: { name: string; icon: string }[];
  }[];
  appearance?: {
    theme?: 'light' | 'dark' | 'system';
  };
}

export interface SettingsImportResult {
  applied: string[];
  skipped: string[];
  user: User;
}
