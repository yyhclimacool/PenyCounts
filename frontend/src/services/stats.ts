import type {
  CategoryBreakdown,
  MemberBreakdown,
  MonthlyTrend,
  SocialSummary,
  Transaction,
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
}

export interface SocialSummaryParams {
  year?: number;
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

export async function memberBreakdown(params?: MemberBreakdownParams): Promise<MemberBreakdown[]> {
  const { data } = await api.get<MemberBreakdown[]>('/stats/member-breakdown', { params });
  return data;
}

export async function socialSummary(params?: SocialSummaryParams): Promise<SocialSummary[]> {
  const { data } = await api.get<SocialSummary[]>('/stats/social-summary', { params });
  return data;
}
