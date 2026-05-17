import type { AuthResponse } from '@/types';
import { api } from './api';

export interface RegisterPayload {
  username: string;
}

export interface LoginPayload {
  username: string;
}

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/register', payload);
  return data;
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', payload);
  return data;
}
