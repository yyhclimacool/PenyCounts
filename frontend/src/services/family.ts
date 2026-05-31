import type { Family, FamilyDetail } from '@/types';
import { api } from './api';

export async function listFamilies(): Promise<Family[]> {
  const { data } = await api.get<Family[]>('/families');
  return data;
}

export async function createFamily(name: string): Promise<Family> {
  const { data } = await api.post<Family>('/families', { name });
  return data;
}

export async function joinFamily(invite_code: string): Promise<Family> {
  const { data } = await api.post<Family>('/families/join', { invite_code });
  return data;
}

export async function getFamilyDetail(id: string): Promise<FamilyDetail> {
  const { data } = await api.get<FamilyDetail>(`/families/${id}`);
  return data;
}

export async function leaveFamily(id: string): Promise<void> {
  await api.post(`/families/${id}/leave`);
}

export async function deleteFamily(id: string): Promise<void> {
  await api.delete(`/families/${id}`);
}

export async function switchDefaultFamily(family_id: string): Promise<void> {
  await api.put('/families/switch', { family_id });
}

export async function regenerateInviteCode(id: string): Promise<string> {
  const { data } = await api.post<{ invite_code: string }>(`/families/${id}/regenerate-code`);
  return data.invite_code;
}
