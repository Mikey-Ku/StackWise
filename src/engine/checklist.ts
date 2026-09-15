import { optionIn, type CatalogIndex } from "./evaluate";
import type { Selection, SlotId } from "./schema";

/**
 * The order things get set up and built in: the app first, the pieces it depends on next, and
 * hosting last, once every environment variable exists.
 */
export const BUILD_ORDER: SlotId[] = ["framework", "database", "login", "email", "files", "payments", "ai", "jobs", "mobile", "hosting"];

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
        env: step.env,
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
