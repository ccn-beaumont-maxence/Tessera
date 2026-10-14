type Saved = number | string | boolean;

/** Headless (and fallback) storage; browsers use localStorage so saves survive reloads. */
const memory = new Map<string, string>();
const PREFIX = 'tess:';

function store(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Blocked storage (private mode, sandboxed frame): fall back to memory.
  }
  return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
}

/** Persists a number, string or bool under `key`. */
export function save(key: string, value: Saved): void {
  try {
    store().setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    memory.set(PREFIX + key, JSON.stringify(value));
  }
}

/** Value saved under `key`, or `fallback` if none (or of another type). */
export function load<T extends Saved>(key: string, fallback: T): T {
  let raw: string | null;
  try {
    raw = store().getItem(PREFIX + key);
  } catch {
    raw = memory.get(PREFIX + key) ?? null;
  }
  if (raw === null) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === typeof fallback ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
