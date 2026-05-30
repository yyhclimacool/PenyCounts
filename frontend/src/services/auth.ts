import type { AuthResponse, User } from '@/types';
import { api } from './api';

export interface RegisterPayload {
  username: string;
  password: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface UpdateProfilePayload {
  username?: string;
  current_password?: string;
  new_password?: string;
  avatar_url?: string;
}

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/register', payload);
  return data;
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', payload);
  return data;
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me');
  return data;
}

export async function updateProfile(payload: UpdateProfilePayload): Promise<AuthResponse> {
  const { data } = await api.put<AuthResponse>('/auth/profile', payload);
  return data;
}
