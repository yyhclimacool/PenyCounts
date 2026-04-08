export interface User {
  id: string;
  email: string;
  nickname: string;
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
  category_name: string;
  icon: string;
  total: string;
  percentage: number;
}

export interface MemberBreakdown {
  member_name: string;
  total: string;
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
