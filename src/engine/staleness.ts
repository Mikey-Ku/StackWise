import type { Catalog, Fact } from "./schema";

/**
 * Prices and limits drift. A fact nobody has rechecked in a while is shown as "may be out of
 * date" in the app, and the source checker (scripts/check-sources.ts) is what keeps the count low.
 */

export const STALE_AFTER_DAYS = 120;

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000);
}

export function isStale(fact: Fact, today: string, maxDays = STALE_AFTER_DAYS): boolean {
  // A person checking the fact against its source counts as reading it again.
  const lastRead = fact.reviewed && fact.reviewed > fact.retrieved ? fact.reviewed : fact.retrieved;
  return daysBetween(lastRead, today) > maxDays;
}

export interface StaleFact {
  optionId: string;
  fact: string;
  retrieved: string;
  ageDays: number;
}

export function staleFacts(catalog: Catalog, today: string, maxDays = STALE_AFTER_DAYS): StaleFact[] {
  return catalog.options.flatMap((option) =>
    Object.entries(option.facts)
      .filter(([, fact]) => isStale(fact, today, maxDays))
      .map(([key, fact]) => ({ optionId: option.id, fact: key, retrieved: fact.retrieved, ageDays: daysBetween(fact.retrieved, today) })),
  );
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
