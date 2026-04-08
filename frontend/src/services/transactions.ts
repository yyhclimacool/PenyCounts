import type { PaginatedResponse, Transaction } from '@/types';
import { api } from './api';

export interface TransactionListFilters {
  type?: 'income' | 'expense';
  category_id?: string;
  subcategory_id?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  per_page?: number;
}

export interface CreateTransactionPayload {
  category_id: string;
  subcategory_id?: string | null;
  type: 'income' | 'expense';
  amount: string;
  currency: string;
  date: string;
  time: string;
  location?: string | null;
  note?: string | null;
  members?: { member_name: string; share_amount: string }[];
}

export interface UpdateTransactionPayload {
  category_id?: string;
  subcategory_id?: string | null;
  type?: 'income' | 'expense';
  amount?: string;
  currency?: string;
  date?: string;
  time?: string;
  location?: string | null;
  note?: string | null;
  members?: { member_name: string; share_amount: string }[];
}

export async function list(
  filters?: TransactionListFilters,
): Promise<PaginatedResponse<Transaction>> {
  const { data } = await api.get<PaginatedResponse<Transaction>>('/transactions', {
    params: filters,
  });
  return data;
}

export async function create(payload: CreateTransactionPayload): Promise<Transaction> {
  const { data } = await api.post<Transaction>('/transactions', payload);
  return data;
}

export async function update(id: string, payload: UpdateTransactionPayload): Promise<Transaction> {
  const { data } = await api.patch<Transaction>(`/transactions/${id}`, payload);
  return data;
}

export async function deleteTransaction(id: string): Promise<void> {
  await api.delete(`/transactions/${id}`);
}
