import type { PaginatedResponse, SocialGift } from '@/types';
import { api } from './api';

export interface SocialGiftListFilters {
  type?: 'give' | 'receive';
  date_from?: string;
  date_to?: string;
  page?: number;
  per_page?: number;
}

export interface CreateSocialGiftPayload {
  type: 'give' | 'receive';
  person_name: string;
  relation?: string | null;
  occasion: string;
  amount: string;
  currency: string;
  date: string;
  note?: string | null;
}

export interface UpdateSocialGiftPayload {
  type?: 'give' | 'receive';
  person_name?: string;
  relation?: string | null;
  occasion?: string;
  amount?: string;
  currency?: string;
  date?: string;
  note?: string | null;
}

export async function list(
  filters?: SocialGiftListFilters,
): Promise<PaginatedResponse<SocialGift>> {
  const { data } = await api.get<PaginatedResponse<SocialGift>>('/social-gifts', {
    params: filters,
  });
  return data;
}

export async function create(payload: CreateSocialGiftPayload): Promise<SocialGift> {
  const { data } = await api.post<SocialGift>('/social-gifts', payload);
  return data;
}

export async function update(id: string, payload: UpdateSocialGiftPayload): Promise<SocialGift> {
  const { data } = await api.patch<SocialGift>(`/social-gifts/${id}`, payload);
  return data;
}

export async function deleteSocialGift(id: string): Promise<void> {
  await api.delete(`/social-gifts/${id}`);
}
