import { initialStore, migrate, type History, type Store } from "./store";

/**
 * Where the applications live: one store in this browser's localStorage. The workspace and the
 * applications page both read and write it here, so they always agree.
 */

export const STORE_KEY = "stackwise.store.v2";
const OLD_KEY = "stackwise.plan.v1";

export function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function loadHistory(): History {
  const now = new Date().toISOString();
  const id = newId();
  try {
    const saved = window.localStorage.getItem(STORE_KEY) ?? window.localStorage.getItem(OLD_KEY);
    const store = saved ? migrate(JSON.parse(saved), id, now) : null;
    if (store) return { store, past: [], future: [] };
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return { store: initialStore(id, now), past: [], future: [] };
}

export function saveStore(store: Store): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    window.localStorage.removeItem(OLD_KEY);
  } catch {
    // Private windows and blocked storage: plans still work, they just won't survive a reload.
  }
}
