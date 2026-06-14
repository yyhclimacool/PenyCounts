// Lightweight, versioned localStorage helpers. All UI-state persistence goes
// through here so keys share a namespace + version and reads/writes are always
// guarded (localStorage throws in private mode, when disabled, or over quota).

const VERSION = 'v1';

function namespacedKey(key: string): string {
  return `pc:${VERSION}:${key}`;
}

export function loadPersisted<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(namespacedKey(key));
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function savePersisted<T>(key: string, value: T): void {
  try {
    localStorage.setItem(namespacedKey(key), JSON.stringify(value));
  } catch {
    // Ignore: private mode / disabled storage / quota exceeded.
  }
}
