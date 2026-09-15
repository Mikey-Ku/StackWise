import { optionIn, type CatalogIndex } from "./evaluate";
import type { Selection, SlotId } from "./schema";

/**
 * The order things get set up and built in: the app first, the pieces it depends on next, and
 * hosting last, once every environment variable exists.
 */
export const BUILD_ORDER: SlotId[] = ["framework", "database", "login", "email", "files", "payments", "ai", "jobs", "mobile", "hosting"];

/**
 * Quickstarts name browser-visible variables the Next.js way. Each framework has its own prefix
 * for variables that reach the browser, so rename them to match the plan's framework.
 */
const PUBLIC_PREFIX: Record<string, string> = { sveltekit: "PUBLIC_", "react-vite": "VITE_" };

export function adaptEnvName(name: string, frameworkId: string | undefined): string {
  const prefix = frameworkId ? PUBLIC_PREFIX[frameworkId] : undefined;
  return prefix && name.startsWith("NEXT_PUBLIC_") ? `${prefix}${name.slice("NEXT_PUBLIC_".length)}` : name;
}

export interface ChecklistItem {
  /** Stable across sessions so checked boxes survive a reload. */
  id: string;
  slot: SlotId;
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
        optionName: option.name,
        text: `Follow ${option.name}'s official quickstart. Its setup steps haven't been researched yet.`,
        env: [],
        source: option.website,
      });
    }
    build.push({ id: `build:${slot}:${option.id}`, slot, optionName: option.name, text: def.build_task.replace("{option}", option.name), env: [] });
  }
  return { setup, build };
}

export function checklistProgress(list: Checklist, checked: Record<string, boolean>): { done: number; total: number } {
  const items = [...list.setup, ...list.build];
  return { done: items.filter((item) => checked[item.id]).length, total: items.length };
}
