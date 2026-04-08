import type { Member } from '@/types';
import { api } from './api';

export interface CreateMemberPayload {
  name: string;
}

export interface UpdateMemberPayload {
  name: string;
}

export async function list(): Promise<Member[]> {
  const { data } = await api.get<Member[]>('/members');
  return data;
}

export async function create(payload: CreateMemberPayload): Promise<Member> {
  const { data } = await api.post<Member>('/members', payload);
  return data;
}

export async function update(id: string, payload: UpdateMemberPayload): Promise<Member> {
  const { data } = await api.patch<Member>(`/members/${id}`, payload);
  return data;
}

export async function deleteMember(id: string): Promise<void> {
  await api.delete(`/members/${id}`);
}
