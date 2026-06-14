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
