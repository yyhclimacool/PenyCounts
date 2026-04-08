import type { Category, Subcategory } from '@/types';
import { api } from './api';

export interface CreateCategoryPayload {
  name: string;
  type: 'income' | 'expense';
  icon: string;
  sort_order?: number;
}

export interface UpdateCategoryPayload {
  name?: string;
  type?: 'income' | 'expense';
  icon?: string;
  sort_order?: number;
}

export interface CreateSubcategoryPayload {
  name: string;
  icon: string;
  sort_order?: number;
}

export interface UpdateSubcategoryPayload {
  name?: string;
  icon?: string;
  sort_order?: number;
}

export async function getAll(): Promise<Category[]> {
  const { data } = await api.get<Category[]>('/categories');
  return data;
}

export async function create(payload: CreateCategoryPayload): Promise<Category> {
  const { data } = await api.post<Category>('/categories', payload);
  return data;
}

export async function update(id: string, payload: UpdateCategoryPayload): Promise<Category> {
  const { data } = await api.patch<Category>(`/categories/${id}`, payload);
  return data;
}

export async function deleteCategory(id: string): Promise<void> {
  await api.delete(`/categories/${id}`);
}

export async function createSubcategory(
  categoryId: string,
  payload: CreateSubcategoryPayload,
): Promise<Subcategory> {
  const { data } = await api.post<Subcategory>(`/categories/${categoryId}/subcategories`, payload);
  return data;
}

export async function updateSubcategory(
  categoryId: string,
  subcategoryId: string,
  payload: UpdateSubcategoryPayload,
): Promise<Subcategory> {
  const { data } = await api.patch<Subcategory>(
    `/categories/${categoryId}/subcategories/${subcategoryId}`,
    payload,
  );
  return data;
}

export async function deleteSubcategory(categoryId: string, subcategoryId: string): Promise<void> {
  await api.delete(`/categories/${categoryId}/subcategories/${subcategoryId}`);
}
