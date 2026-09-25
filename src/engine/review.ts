import { optionIn, type CatalogIndex } from "./evaluate";
import { locate, objectAt, removeMember, setMember } from "./jsontext";
import { SLOT_IDS, type Fact, type FactValue, type Option, type PlanInput, type Selection, type SlotId } from "./schema";
import { recommend, scoreFacts } from "./score";
import { formatFactValue } from "./text";

/**
 * Which facts a person should check against their sources first. Every fact is a draft until a
 * person reviews it (invariant 6), and there are hundreds, so the review starts with the ones the
 * default plans rest on: the facts the rules and the ranking read for every option the starting
 * templates and the demo end up with. Nothing here marks anything verified; that takes a person
 * on the review page.
 */

export interface FactRef {
  optionId: string;
  fact: string;
}

/**
 * The facts the rules and the ranking read for one option in one part: the part's required facts
 * (the only ones rules may read, invariant 4) and the score's criteria, as far as the option has them.
 */
export function factsReadFor(index: CatalogIndex, option: Option, slot: SlotId): string[] {
  const keys = new Set([...(index.slotsById.get(slot)?.required_facts ?? []), ...scoreFacts(slot)]);
  return [...keys].filter((key) => Object.hasOwn(option.facts, key));
}

/** The facts behind a plan: what the rules and the ranking read for every part it fills, and for its extra services. */
export function factsBehindPlan(index: CatalogIndex, selection: Selection, extras: PlanInput["extras"] = {}): FactRef[] {
  const refs = new Map<string, FactRef>();
  const add = (option: Option | undefined, slot: SlotId) => {
    if (!option) return;
    for (const fact of factsReadFor(index, option, slot)) refs.set(`${option.id}.${fact}`, { optionId: option.id, fact });
  };
  for (const slot of SLOT_IDS) add(optionIn(index, selection, slot), slot);
  for (const extra of Object.values(extras)) add(index.optionsById.get(extra.option), extra.slot);
  return [...refs.values()];
}

/** How many of these facts a person has reviewed. */
export function reviewedCount(index: CatalogIndex, refs: FactRef[]): number {
  return refs.filter((ref) => index.optionsById.get(ref.optionId)?.facts[ref.fact]?.status === "verified").length;
}

/** A starting plan whose picks the review puts first: a template's answers, or a demo plan. */
export interface ReviewDefault {
  label: string;
  input: PlanInput;
  pinned?: Selection;
}

export interface ReviewItem {
  /** "<optionId>.<fact>" */
  key: string;
  optionId: string;
  optionName: string;
  /** The option's parts, by label. */
  parts: string[];
  fact: string;
  label: string;
  help: string;
  value: FactValue;
  /** The value as the planner shows it. */
  display: string;
  note: string;
  source: string;
  retrieved: string;
  status: Fact["status"];
  reviewed?: string;
  /** "defaults": a default plan reads it. "other": any other fact of a fully researched option. */
  tier: "defaults" | "other";
  /** The default plans that picked this option by score, and the ones that start with it chosen. */
  picks: string[];
  startsWith: string[];
  why: string;
}

/** "A", "A and B", "A, B and C". */
export function listWords(words: string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : (words[0] ?? "");
}

/**
 * Every fact worth reviewing, most important first. First the facts behind the default plans,
 * the ones used by the most defaults first, each option's facts together in its part's order. Then
 * every other fact of a fully researched option, by part and name. Partly researched options come
 * in only when a default plan uses one: nothing else picks them.
 */
export function reviewList(index: CatalogIndex, defaults: ReviewDefault[]): ReviewItem[] {
  const usage = new Map<string, { ref: FactRef; picks: string[]; startsWith: string[]; first: number }>();
  for (const plan of defaults) {
    const rec = recommend(index, plan.input, plan.pinned ?? {});
    const count = (option: Option | undefined, slot: SlotId, byScore: boolean) => {
      if (!option) return;
      for (const fact of factsReadFor(index, option, slot)) {
        const key = `${option.id}.${fact}`;
        const entry = usage.get(key) ?? { ref: { optionId: option.id, fact }, picks: [], startsWith: [], first: usage.size };
        const list = byScore ? entry.picks : entry.startsWith;
        if (!list.includes(plan.label)) list.push(plan.label);
        usage.set(key, entry);
      }
    };
    for (const slot of SLOT_IDS) count(optionIn(index, rec.selection, slot), slot, rec.autoPicked.includes(slot));
    for (const extra of Object.values(plan.input.extras ?? {})) count(index.optionsById.get(extra.option), extra.slot, false);
  }

  const item = (ref: FactRef, tier: ReviewItem["tier"], picks: string[], startsWith: string[]): ReviewItem => {
    const option = index.optionsById.get(ref.optionId)!;
    const fact = option.facts[ref.fact];
    const def = index.catalog.facts[ref.fact];
    const why =
      tier === "other"
        ? `Read whenever ${option.name} is in a plan.`
        : [
            picks.length > 0 && (picks.length === defaults.length && defaults.length > 2 ? `Decides the pick in every default plan (${picks.length}).` : `Decides the pick for ${listWords(picks)}.`),
            startsWith.length > 0 && `Checked in ${listWords(startsWith)}, which ${startsWith.length === 1 ? "starts" : "start"} with ${option.name}.`,
          ]
            .filter(Boolean)
            .join(" ");
    return {
      key: `${option.id}.${ref.fact}`,
      optionId: option.id,
      optionName: option.name,
      parts: option.slots.map((slot) => index.slotsById.get(slot)?.label ?? slot),
      fact: ref.fact,
      label: def?.label ?? ref.fact,
      help: def?.help ?? "",
      value: fact.value,
      display: formatFactValue(index, def, fact.value),
      note: fact.note,
      source: fact.source,
      retrieved: fact.retrieved,
      status: fact.status,
      ...(fact.reviewed ? { reviewed: fact.reviewed } : {}),
      tier,
      picks,
      startsWith,
      why,
    };
  };

  const behind = [...usage.values()]
    .sort((a, b) => b.picks.length + b.startsWith.length - (a.picks.length + a.startsWith.length) || a.first - b.first)
    .map((u) => item(u.ref, "defaults", u.picks, u.startsWith));

  const slotRank = (option: Option) => Math.min(...option.slots.map((slot) => SLOT_IDS.indexOf(slot)));
  const rest = index.catalog.options
    .filter((option) => option.coverage === "full")
    .sort((a, b) => slotRank(a) - slotRank(b) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
    .flatMap((option) =>
      Object.keys(option.facts)
        .filter((fact) => !usage.has(`${option.id}.${fact}`))
        .map((fact) => item({ optionId: option.id, fact }, "other", [], [])),
    );

  return [...behind, ...rest];
}

export interface ReviewCounts {
  total: number;
  reviewed: number;
  behindDefaults: number;
  behindDefaultsReviewed: number;
}

export function reviewCounts(items: Pick<ReviewItem, "tier" | "status">[]): ReviewCounts {
  const behind = items.filter((i) => i.tier === "defaults");
  return {
    total: items.length,
    reviewed: items.filter((i) => i.status === "verified").length,
    behindDefaults: behind.length,
    behindDefaultsReviewed: behind.filter((i) => i.status === "verified").length,
  };
}

export type FactReview = { status: "verified"; reviewed: string } | { status: "draft" };

/**
 * An option file's text with one fact's review changed and nothing else. "verified" sets the status
 * and a `reviewed` date right after it; "draft" sets the status back and drops the date. Key order,
 * spacing and every other line stay as they were, so the diff is that fact's lines alone. Throws
 * when the fact isn't in the file, or when the edit would change anything else.
 */
export function editFactReview(text: string, fact: string, review: FactReview): string {
  const before = JSON.parse(text) as { facts?: Record<string, Record<string, unknown>> };
  if (!before.facts || !Object.hasOwn(before.facts, fact)) throw new Error(`no fact "${fact}" in this file`);

  let next = setMember(text, objectAt(locate(text), ["facts", fact])!, "status", review.status);
  const object = objectAt(locate(next), ["facts", fact])!;
  next = review.status === "verified" ? setMember(next, object, "reviewed", review.reviewed, "status") : removeMember(next, object, "reviewed");

  const expected = structuredClone(before);
  const entry = expected.facts![fact];
  entry.status = review.status;
  if (review.status === "verified") entry.reviewed = review.reviewed;
  else delete entry.reviewed;
  if (!sameJson(JSON.parse(next), expected)) throw new Error(`editing "${fact}" would change more than its review`);
  return next;
}

/** Deep equality for parsed JSON, ignoring key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
