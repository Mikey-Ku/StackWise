import { optionIn, type CatalogIndex } from "./evaluate";
import type { Selection, SlotId } from "./schema";
import { buildTask, isOwn } from "./own";

/**
 * The order things get set up and built in: the app first, the pieces it depends on next, and
 * hosting last, once every environment variable exists.
 */
export const BUILD_ORDER: SlotId[] = ["framework", "domain", "database", "login", "email", "files", "payments", "ai", "data_apis", "scraping", "jobs", "automations", "analytics", "monitoring", "mobile", "hosting"];

/**
 * Quickstarts name browser-visible variables the Next.js way. Each framework has its own prefix
 * for variables that reach the browser, so rename them to match the plan's framework.
 */
const PUBLIC_PREFIX: Record<string, string> = { sveltekit: "PUBLIC_", "react-vite": "VITE_" };

/**
 * Frameworks that render pages on the server have no way to hand an env variable to the browser,
 * so a "public" name means nothing there: the value is read on the server like any other.
 */
const SERVER_ONLY = new Set(["spring-boot", "django", "fastapi", "rails", "laravel", "express", "go-net-http", "aspnet-core"]);

export function adaptEnvName(name: string, frameworkId: string | undefined): string {
  if (!frameworkId || !name.startsWith("NEXT_PUBLIC_")) return name;
  if (SERVER_ONLY.has(frameworkId)) return name.slice("NEXT_PUBLIC_".length);
  const prefix = PUBLIC_PREFIX[frameworkId];
  return prefix ? `${prefix}${name.slice("NEXT_PUBLIC_".length)}` : name;
}

export interface ChecklistItem {
  /** Stable across sessions so checked boxes survive a reload. */
  id: string;
  slot: SlotId;
  optionId: string;
  optionName: string;
  text: string;
  env: string[];
  source?: string;
}

export interface Checklist {
  setup: ChecklistItem[];
  build: ChecklistItem[];
}

export function buildChecklist(index: CatalogIndex, selection: Selection): Checklist {
  const setup: ChecklistItem[] = [];
  const build: ChecklistItem[] = [];
  for (const slot of BUILD_ORDER) {
    const option = optionIn(index, selection, slot);
    const def = index.slotsById.get(slot);
    if (!option || !def) continue;
    option.setup.forEach((step, i) => {
      setup.push({
        id: `setup:${option.id}:${i}`,
        slot,
        optionId: option.id,
        optionName: option.name,
        text: step.step,
        env: step.env.map((name) => adaptEnvName(name, selection.framework)),
        source: /^https?:\/\//.test(step.source) ? step.source : undefined,
      });
    });
    if (option.setup.length === 0) {
      setup.push({
        id: `setup:${option.id}:quickstart`,
        slot,
        optionId: option.id,
        optionName: option.name,
        text: isOwn(option.id)
          ? `Get your own ${def.label.toLowerCase()} running, and put how the app reaches it (an address, a key) in environment variables.`
          : `Follow ${option.name}'s official quickstart. Its setup steps haven't been researched yet.`,
        env: [],
        source: option.website || undefined,
      });
    }
    build.push({ id: `build:${slot}:${option.id}`, slot, optionId: option.id, optionName: option.name, text: buildTask(def, option), env: [] });
  }
  return { setup, build };
}

/**
 * One service's setup, as a person reads it: its steps once, however many parts it fills, with
 * one docs link for the service and any other pages it uses kept apart. Steps a service shares
 * with an earlier one from the same company (Firebase's "Create a Firebase project" for both
 * Firestore and Firebase Auth) are listed only the first time.
 */
export interface SetupGroup {
  optionId: string;
  optionName: string;
  /** Every part this service fills, in build order. */
  slots: SlotId[];
  items: ChecklistItem[];
  /** The docs page most of its steps come from. */
  docs?: string;
  /** Any other docs pages, with the step (1 based) that first uses each. */
  moreDocs: { url: string; step: number }[];
  /** Steps left out because an earlier service from the same company already lists them. */
  shared?: { withName: string; count: number };
}

/** The docs page used most, first one on a tie, and the rest in order of first use. */
function docsOf(items: ChecklistItem[]): Pick<SetupGroup, "docs" | "moreDocs"> {
  const counts = new Map<string, number>();
  for (const item of items) if (item.source) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  if (counts.size === 0) return { moreDocs: [] };
  const docs = [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  const moreDocs = [...counts.keys()].filter((url) => url !== docs).map((url) => ({ url, step: items.findIndex((i) => i.source === url) + 1 }));
  return { docs, moreDocs };
}

export function setupGroups(index: CatalogIndex, list: Checklist): SetupGroup[] {
  const groups = new Map<string, SetupGroup>();
  /** The first item with each step text, per company, so a shared step shows once. */
  const seen = new Map<string, { item: ChecklistItem; groupName: string }>();
  for (const item of list.setup) {
    const existing = groups.get(item.optionId);
    if (existing) {
      // The same service in a second part: its steps are already listed.
      if (!existing.slots.includes(item.slot)) existing.slots.push(item.slot);
      continue;
    }
    const provider = index.optionsById.get(item.optionId)?.provider ?? item.optionId;
    const steps = list.setup.filter((i) => i.optionId === item.optionId && i.slot === item.slot);
    const items: ChecklistItem[] = [];
    const sharedWith: string[] = [];
    for (const step of steps) {
      const key = `${provider}\n${step.text.trim().toLowerCase()}`;
      const first = seen.get(key);
      if (first && first.item.optionId !== step.optionId) {
        // Keep every variable the shared step names, from both services.
        for (const name of step.env) if (!first.item.env.includes(name)) first.item.env.push(name);
        sharedWith.push(first.groupName);
        continue;
      }
      const copy = { ...step, env: [...step.env] };
      seen.set(key, { item: copy, groupName: item.optionName });
      items.push(copy);
    }
    groups.set(item.optionId, {
      optionId: item.optionId,
      optionName: item.optionName,
      slots: [item.slot],
      items,
      ...docsOf(items),
      ...(sharedWith.length ? { shared: { withName: sharedWith[0], count: sharedWith.length } } : {}),
    });
  }
  return [...groups.values()];
}

/** Each step counts once, even when its service fills two parts or shares it with another service. */
export function checklistProgress(list: Checklist, checked: Record<string, boolean>, index?: CatalogIndex): { done: number; total: number } {
  const setup = index ? setupGroups(index, list).flatMap((g) => g.items) : [...new Map(list.setup.map((i) => [i.id, i])).values()];
  const items = [...setup, ...list.build];
  return { done: items.filter((item) => checked[item.id]).length, total: items.length };
}
