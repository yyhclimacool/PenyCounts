import type { SettingsExport, SettingsImportResult } from '@/types';
import { api } from './api';

export async function exportSettings(): Promise<SettingsExport> {
  const { data } = await api.get<SettingsExport>('/settings/export');
  return data;
}

export async function importSettings(
  payload: SettingsExport,
): Promise<SettingsImportResult> {
  const { data } = await api.post<SettingsImportResult>('/settings/import', payload);
  return data;
}
