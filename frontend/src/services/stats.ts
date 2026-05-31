import type {
  CategoryBreakdown,
  DailyHeatmap,
  DailyTrend,
  MemberBreakdown,
  MonthlyTrend,
  SocialSummary,
  SubcategoryBreakdown,
  Transaction,
  YearlyTrend,
} from '@/types';
import { api } from './api';

export interface MonthlyTrendParams {
  year?: number;
}

export interface MonthlyDetailParams {
  year: number;
  month: number;
}

export interface CategoryBreakdownParams {
  year?: number;
  month?: number;
  type?: 'income' | 'expense';
}

export interface MemberBreakdownParams {
  year?: number;
  month?: number;
  type?: 'income' | 'expense';
}

export interface SocialSummaryParams {
  year?: number;
}

export interface DailyTrendParams {
  year: number;
  month: number;
}

export async function monthlyTrend(params?: MonthlyTrendParams): Promise<MonthlyTrend[]> {
  const { data } = await api.get<MonthlyTrend[]>('/stats/monthly-trend', { params });
  return data;
}

export async function monthlyDetail(params: MonthlyDetailParams): Promise<Transaction[]> {
  const { data } = await api.get<Transaction[]>('/stats/monthly-detail', { params });
  return data;
}

export async function categoryBreakdown(
  params?: CategoryBreakdownParams,
): Promise<CategoryBreakdown[]> {
  const { data } = await api.get<CategoryBreakdown[]>('/stats/category-breakdown', { params });
  return data;
}

export async function subcategoryBreakdown(
  params?: CategoryBreakdownParams,
): Promise<SubcategoryBreakdown[]> {
  const { data } = await api.get<SubcategoryBreakdown[]>('/stats/subcategory-breakdown', { params });
  return data;
}

export async function memberBreakdown(params?: MemberBreakdownParams): Promise<MemberBreakdown[]> {
  const { data } = await api.get<MemberBreakdown[]>('/stats/member-breakdown', { params });
  return data;
}

export async function socialSummary(params?: SocialSummaryParams): Promise<SocialSummary[]> {
  const { data } = await api.get<SocialSummary[]>('/stats/social-summary', { params });
  return data;
}

export async function dailyHeatmap(params: MonthlyTrendParams): Promise<DailyHeatmap[]> {
  const { data } = await api.get<DailyHeatmap[]>('/stats/daily-heatmap', { params });
  return data;
}

export async function dailyTrend(params: DailyTrendParams): Promise<DailyTrend[]> {
  const { data } = await api.get<DailyTrend[]>('/stats/daily-trend', { params });
  return data;
}

export async function yearlyTrend(): Promise<YearlyTrend[]> {
  const { data } = await api.get<YearlyTrend[]>('/stats/yearly-trend');
  return data;
}
