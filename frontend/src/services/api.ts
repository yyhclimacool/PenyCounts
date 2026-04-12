import axios from 'axios';
import { logger } from '@/utils/logger';

export const AUTH_TOKEN_KEY = 'penycounts_token';

const baseURL = import.meta.env.VITE_API_URL ?? '/api';

export const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const method = (config.method ?? 'get').toUpperCase();
  const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
  logger.debug('API', `→ ${method} ${url}`, config.params ?? '');

  (config as unknown as Record<string, unknown>)._startTime = Date.now();

  return config;
});

api.interceptors.response.use(
  (response) => {
    const start = (response.config as unknown as Record<string, unknown>)._startTime as number | undefined;
    const duration = start ? Date.now() - start : 0;
    const method = (response.config.method ?? 'get').toUpperCase();
    const url = `${response.config.baseURL ?? ''}${response.config.url ?? ''}`;

    logger.info('API', `← ${response.status} ${method} ${url} (${duration}ms)`);

    return response;
  },
  (error) => {
    const config = error.config;
    const start = config?._startTime as number | undefined;
    const duration = start ? Date.now() - start : 0;
    const method = (config?.method ?? 'get').toUpperCase();
    const url = config ? `${config.baseURL ?? ''}${config.url ?? ''}` : 'unknown';
    const status = error.response?.status ?? 'NETWORK';
    const message = error.response?.data?.error ?? error.message;

    logger.error('API', `← ${status} ${method} ${url} (${duration}ms): ${message}`);

    if (error.response?.status === 401) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/login')) {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  },
);
