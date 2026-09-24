/**
 * StackWise's keys in this browser start with "stackwise.". Before the rename they started with
 * "whystack.", so the first load after it moves each old key over (plans, settings, widths) and
 * removes the old one. A key already saved under the new name wins.
 */
export function migrateLegacyStorage(): void {
  try {
    const old: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith("whystack.")) old.push(key);
    }
    for (const key of old) {
      const next = `stackwise.${key.slice("whystack.".length)}`;
      const value = window.localStorage.getItem(key);
      if (value !== null && window.localStorage.getItem(next) === null) window.localStorage.setItem(next, value);
      window.localStorage.removeItem(key);
    }
  } catch {
    // Private windows or blocked storage: nothing to move.
  }
}
