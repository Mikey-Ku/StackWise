import { needIsOn, type CatalogIndex, type CheckResult } from "./evaluate";
import { recommend, type Recommendation } from "./score";
import type { PlanInput, Selection } from "./schema";

/**
 * Follow-up questions. A question is only worth a beginner's time if its answer could change the
 * plan: which slots are needed, which options get picked, or which problems show up. Notes alone
 * don't count. Everything else waits in the optional "sharpen your plan" list.
 */

function signature(rec: Recommendation): string {
  const serious = (results: CheckResult[]) =>
    results
      .filter((r) => r.level !== "info")
      .map((r) => r.key)
      .sort()
      .join(",");
  return [rec.needed.join(","), JSON.stringify(rec.selection), serious(rec.results)].join("#");
}

export function questionsThatMatter(index: CatalogIndex, input: PlanInput, pinned: Selection = {}, max = 5): string[] {
  const base = signature(recommend(index, input, pinned));
  const matters: string[] = [];
  for (const need of index.catalog.needs) {
    if (input.answers[need.id] !== undefined) continue;
    if (need.only_if && !needIsOn(index, input, need.only_if)) continue;
    const flipped = { ...input, answers: { ...input.answers, [need.id]: "yes" as const } };
    if (signature(recommend(index, flipped, pinned)) !== base) matters.push(need.id);
    if (matters.length === max) break;
  }
  return matters;
}

export interface HeadsUp {
  needId: string;
  note: string;
  changes: string[];
}

/** For each "not sure" answer, what would change if the answer turns out to be yes. */
export function headsUps(index: CatalogIndex, input: PlanInput, pinned: Selection = {}): HeadsUp[] {
  const base = recommend(index, input, pinned);
  const baseKeys = new Set(base.results.map((r) => r.key));
  const out: HeadsUp[] = [];
  for (const need of index.catalog.needs) {
    if (input.answers[need.id] !== "not_sure") continue;
    const flipped = recommend(index, { ...input, answers: { ...input.answers, [need.id]: "yes" } }, pinned);
    const changes: string[] = [];
    for (const slot of flipped.needed) {
      if (!base.needed.includes(slot)) {
        const option = flipped.selection[slot] ? index.optionsById.get(flipped.selection[slot]!) : undefined;
        const label = index.slotsById.get(slot)?.label ?? slot;
        changes.push(option ? `Adds ${label}: ${option.name}` : `Adds ${label}`);
      }
    }
    for (const slot of base.needed) {
      const before = base.selection[slot];
      const after = flipped.selection[slot];
      if (before && after && before !== after) {
        changes.push(`Switches ${index.slotsById.get(slot)?.label} from ${index.optionsById.get(before)?.name} to ${index.optionsById.get(after)?.name}`);
      }
    }
    for (const result of flipped.results) {
      if (result.level !== "info" && !baseKeys.has(result.key)) changes.push(result.title);
    }
    out.push({ needId: need.id, note: need.not_sure_note, changes });
  }
  return out;
}
