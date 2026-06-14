import { useState, useEffect } from 'react';

import { loadPersisted, savePersisted } from '@/utils/persist';

/**
 * Like `useState`, but the value is initialized from and synced to
 * localStorage under the given key. Use for remembering UI state across
 * refreshes (selected tab, year, etc.).
 */
export function usePersistentState<T>(
  key: string,
  fallback: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  // Lazy init so we read storage only once on mount.
  const [state, setState] = useState<T>(() => loadPersisted(key, fallback));

  useEffect(() => {
    savePersisted(key, state);
  }, [key, state]);

  return [state, setState];
}
