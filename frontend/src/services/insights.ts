import type { InsightsResponse } from '@/types';
import { api } from './api';

export async function getInsights(): Promise<InsightsResponse> {
  const { data } = await api.get<InsightsResponse>('/insights');
  return data;
}
