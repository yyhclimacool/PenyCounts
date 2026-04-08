import { create } from 'zustand';

import type { User } from '@/types';
import { AUTH_TOKEN_KEY } from '@/services/api';

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: readStoredToken(),
  isAuthenticated: Boolean(readStoredToken()),
  login: (token, user) => {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    set({ token, user, isAuthenticated: true });
  },
  logout: () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    set({ token: null, user: null, isAuthenticated: false });
  },
  setUser: (user) => set({ user }),
}));
