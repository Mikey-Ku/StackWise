import type { SharedPlan } from "./share";

/**
 * Merging two copies of a plan that both changed since they last agreed: the project's
 * whystack.plan.json (an agent working in a terminal) and StackWise's shared copy (the browser, or
 * an agent paired over HTTP). A three-way merge against the last copy both had, so a note written
 * in the browser and a part swapped in the terminal both survive. Answers, parts, notes and custom parts merge
 * key by key; only when both sides changed the same key differently does the newer side win, and
 * those keys are reported so the person can see what was decided for them.
 */

const MAP_FIELDS = ["answers", "pinned", "notes", "custom"] as const;
const SCALAR_FIELDS = ["appName", "description", "features", "size", "priority", "builderId"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface MergeResult {
  plan: SharedPlan;
  /** Fields or keys both sides changed differently, where the newer side won. */
  conflicts: string[];
}

function pick<T>(base: T, ours: T, theirs: T, oursNewer: boolean, name: string, conflicts: string[]): T {
  if (same(ours, theirs)) return ours;
  if (same(ours, base)) return theirs;
  if (same(theirs, base)) return ours;
  conflicts.push(name);
  return oursNewer ? ours : theirs;
}

/** Merge `ours` and `theirs`, both descended from `base`. `oursNewer` breaks ties. */
export function mergePlans(base: SharedPlan, ours: SharedPlan, theirs: SharedPlan, oursNewer: boolean): MergeResult {
  const conflicts: string[] = [];
  const plan: SharedPlan = { ...theirs };
  for (const field of SCALAR_FIELDS) {
    (plan as unknown as Record<string, unknown>)[field] = pick(base[field], ours[field], theirs[field], oursNewer, field, conflicts);
  }
  for (const field of MAP_FIELDS) {
    const b = (base[field] ?? {}) as Record<string, unknown>;
    const o = (ours[field] ?? {}) as Record<string, unknown>;
    const t = (theirs[field] ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
      const value = pick(b[key], o[key], t[key], oursNewer, `${field}.${key}`, conflicts);
      if (value !== undefined) merged[key] = value;
    }
    (plan as unknown as Record<string, unknown>)[field] = merged;
  }
  return { plan, conflicts };
}
