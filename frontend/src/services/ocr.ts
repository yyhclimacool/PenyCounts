import type { OcrAvailability, OcrResult } from '@/types';
import { api } from './api';

export async function getOcrAvailability(): Promise<OcrAvailability> {
  const { data } = await api.get<OcrAvailability>('/ai/ocr/availability');
  return data;
}

export async function extractFromImage(file: File): Promise<OcrResult> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<OcrResult>('/ai/ocr', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return data;
}
