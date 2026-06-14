import type { StreakResponse } from '@/types';
import { api } from './api';

export async function getStreak(): Promise<StreakResponse> {
  const { data } = await api.get<StreakResponse>('/streak');
  return data;
}
