import { evaluatePlan, factSlots, needIsOn, optionIn, ruleSlots, worstLevel, type CatalogIndex, type CheckResult, type Level } from "./evaluate";
import { buildChecklist, type Checklist, type ChecklistItem } from "./checklist";
import { SLOT_IDS, type Extra, type PlanInput, type Selection, type SlotId } from "./schema";
import { planEnv } from "./wiring";

/**
 * More than one service in a part, and lines people draw between the things in a plan.
 *
 * An extra is a second (third…) use of a part: a cache next to the main database, an embeddings
 * model next to the main AI. Its id is "<part>.<name>" ("database.cache"). The first service in
 * each part stays where it is, so ranking and search don't change; an extra is always the
 * person's (or their agent's) choice. The rules check an extra exactly as they would check it in
 * that part's place, and each result says which extra it's about.
 *
 * A link is a line between two things in the plan (the app, a part, an extra, a part added by
 * hand), like "Stripe calls the app" or "the jobs service reads the database". A link takes its
 * verdict from the rules when a rule covers those two parts, and is "not checked" otherwise: it's
 * the person's statement of how things talk, never a claim that they work.
 */

export const EXTRA_ID = /^[a-z_]+\.[a-z0-9-]{1,30}$/;
export const LINK_KINDS = ["calls", "webhook", "reads", "writes", "sends_events", "dns"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_WORDS: Record<LinkKind, string> = {
  calls: "calls",
  webhook: "sends webhooks to",
  reads: "reads from",
  writes: "writes to",
  sends_events: "sends events to",
  dns: "points its DNS at",
};

export interface Link {
  from: string;
  to: string;
  kind: LinkKind;
  /** What travels, in the person's words: "payment succeeded events", "user rows". */
  what?: string;
}

export const extraSlot = (id: string): SlotId | null => {
  const slot = id.split(".")[0];
  return (SLOT_IDS as readonly string[]).includes(slot) ? (slot as SlotId) : null;
};

/** A link's id from its ends, so the same two things in the same direction are linked once. */
export const linkId = (from: string, to: string) => `${from}>${to}`;

/**
 * The rules' results for each extra, run with the extra in its part's place and the rest of the
 * plan as it is. Only results about that part are kept, each tagged with the extra, and "missing"
 * results never apply (the part's first service already answers the need).
 */
export function extraResults(index: CatalogIndex, selection: Selection, input: PlanInput): CheckResult[] {
  const results: CheckResult[] = [];
  for (const [id, extra] of Object.entries(input.extras ?? {})) {
    const option = index.optionsById.get(extra.option);
    if (!option || !option.slots.includes(extra.slot)) {
      results.push({
        key: `${id}:unknown-option`,
        ruleId: "extra",
        source: "coverage",
        level: "unknown",
        slots: [extra.slot],
        instance: id,
        title: `${extra.option} isn't a ${extra.slot} option StackWise knows`,
        explanation: "StackWise can't check an option it has no facts on.",
      });
      continue;
    }
    const swapped: Selection = { ...selection, [extra.slot]: option.id };
    for (const result of evaluatePlan(index, swapped, { ...input, extras: undefined })) {
      if (result.source === "missing" || !result.slots.includes(extra.slot)) continue;
      results.push({ ...result, key: `${id}:${result.key}`, instance: id });
    }
  }
  return results;
}

/** Where a link end sits: a part or an extra (with the part it fills), the app, or something else. */
export function linkEnd(end: string, selection: Selection, input: PlanInput, custom: Record<string, unknown> = {}): { slot?: SlotId; instance?: string; exists: boolean } {
  if (end === "app") return { slot: "framework", exists: true };
  if ((SLOT_IDS as readonly string[]).includes(end)) return { slot: end as SlotId, exists: Boolean(selection[end as SlotId]) };
  if (input.extras?.[end]) return { slot: input.extras[end].slot, instance: end, exists: true };
  return { exists: end in custom };
}

/**
 * A link's verdict: the worst result of the rules that read both of its parts (for the exact
 * services at each end). When such a rule applies and found nothing, the link works; when no rule
 * reads that pair, the link is "unknown", because nothing checked it.
 */
export function linkVerdict(
  index: CatalogIndex,
  results: CheckResult[],
  link: Link,
  selection: Selection,
  input: PlanInput,
): { level: Level | "works"; checked: boolean; results: CheckResult[] } {
  const a = linkEnd(link.from, selection, input);
  const b = linkEnd(link.to, selection, input);
  if (!a.slot || !b.slot || a.slot === b.slot) return { level: "unknown", checked: false, results: [] };
  const covering = results.filter((r) => {
    if (r.slots.length !== 2 || !r.slots.includes(a.slot!) || !r.slots.includes(b.slot!)) return false;
    // An extra's results carry its id; the part's own results carry none.
    const instances = [a.instance, b.instance].filter(Boolean);
    return instances.length === 0 ? !r.instance : r.instance === instances[0];
  });
  if (covering.length) return { level: worstLevel(covering), checked: true, results: covering };
  // Nothing flagged: it works only if some rule that reads these two parts applies to this plan.
  const at = { ...selection, ...(a.instance ? { [a.slot]: input.extras![a.instance].option } : {}), ...(b.instance ? { [b.slot]: input.extras![b.instance].option } : {}) };
  const applies = index.catalog.capabilityRules.some((rule) => {
    const slots = ruleSlots(rule);
    return slots.includes(a.slot!) && slots.includes(b.slot!) && rule.needs.every((n) => needIsOn(index, input, n)) && factSlots(rule).every((s) => optionIn(index, at, s));
  });
  return applies ? { level: "works", checked: true, results: [] } : { level: "unknown", checked: false, results: [] };
}

/** The option filling an end, when it's a part or an extra. */
export function endOption(index: CatalogIndex, end: string, selection: Selection, input: PlanInput) {
  if (end === "app") return optionIn(index, selection, "framework");
  if ((SLOT_IDS as readonly string[]).includes(end)) return optionIn(index, selection, end as SlotId);
  const extra = input.extras?.[end];
  return extra ? index.optionsById.get(extra.option) : undefined;
}


/** Setup and build steps for each extra, with its variables named as planEnv names them. */
export function extraChecklist(index: CatalogIndex, selection: Selection, extras: Record<string, Extra> = {}): Checklist {
  const setup: ChecklistItem[] = [];
  const build: ChecklistItem[] = [];
  const vars = planEnv(index, selection, extras);
  for (const [id, extra] of Object.entries(extras)) {
    const option = index.optionsById.get(extra.option);
    const def = index.slotsById.get(extra.slot);
    if (!option || !def) continue;
    const name = `${option.name} (${extra.role || id})`;
    option.setup.forEach((step, i) => {
      setup.push({
        id: `setup:${id}:${i}`,
        slot: extra.slot,
        optionId: option.id,
        optionName: name,
        text: step.step,
        env: vars.filter((v) => v.instance === id && v.step === step.step).map((v) => v.name),
        source: /^https?:\/\//.test(step.source) ? step.source : undefined,
      });
    });
    build.push({ id: `build:${id}`, slot: extra.slot, optionId: option.id, optionName: name, text: `Connect ${name} for ${extra.role || "its job"}, next to the ${def.label.toLowerCase()} you already have.`, env: [] });
  }
  return { setup, build };
}

/** The plan's full checklist: the parts' steps, then each extra's. */
export function fullChecklist(index: CatalogIndex, selection: Selection, extras: Record<string, Extra> = {}): Checklist {
  const base = buildChecklist(index, selection);
  const more = extraChecklist(index, selection, extras);
  return { setup: [...base.setup, ...more.setup], build: [...base.build, ...more.build] };
}
