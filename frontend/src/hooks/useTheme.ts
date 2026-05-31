import { useCallback, useEffect, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

function getSnapshot(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'system';
}

function getServerSnapshot(): Theme {
  return 'system';
}

let listeners: (() => void)[] = [];

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function emitChange() {
  for (const l of listeners) l();
}

function applyTheme(theme: Theme) {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    if (next === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
    applyTheme(next);
    emitChange();
  }, []);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme:dark)');
    const handler = () => {
      if (getSnapshot() === 'system') applyTheme('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return { theme, setTheme } as const;
}
