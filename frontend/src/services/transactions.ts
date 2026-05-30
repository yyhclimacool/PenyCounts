import type { PaginatedResponse, Transaction } from '@/types';
import { api } from './api';

export interface TransactionListFilters {
  type?: 'income' | 'expense';
  category_id?: string;
  subcategory_id?: string;
  member_name?: string;
  start_date?: string;
  end_date?: string;
  search?: string;
  min_amount?: string;
  max_amount?: string;
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
  members?: string[];
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
  members?: string[];
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
  const { data } = await api.put<Transaction>(`/transactions/${id}`, payload);
  return data;
}

export async function deleteTransaction(id: string): Promise<void> {
  await api.delete(`/transactions/${id}`);
}

export async function clearAllTransactions(): Promise<{ deleted: number }> {
  const { data } = await api.delete<{ deleted: number }>('/transactions/clear');
  return data;
}

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importCsv(content: string): Promise<ImportResult> {
  const { data } = await api.post<ImportResult>('/transactions/import', { content });
  return data;
}

export async function exportCsv(filters: Record<string, unknown> = {}): Promise<void> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value != null && value !== '' && value !== 'all') {
      params.set(key, String(value));
    }
  }
  const response = await api.get('/transactions/export', {
    params,
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'transactions.csv';
  a.click();
  URL.revokeObjectURL(url);
}
