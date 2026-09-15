import {
  SLOT_IDS,
  type CapabilityRule,
  type Catalog,
  type Condition,
  type FactValue,
  type Need,
  type Option,
  type PlanInput,
  type ProductRule,
  type Selection,
  type SlotDef,
  type SlotId,
} from "./schema";

/**
 * The connection logic. Given which option sits in each slot and what the beginner answered,
 * decide every verdict. Nothing here calls an AI: the same plan always gets the same verdicts.
 */

export type Level = "blocked" | "missing" | "warning" | "unknown" | "info";

/** Most serious first. Anything without a result "works". */
export const LEVEL_ORDER: Level[] = ["blocked", "missing", "warning", "unknown", "info"];

export interface CheckResult {
  key: string;
  ruleId: string;
  source: "capability" | "product" | "missing" | "coverage";
  level: Level;
  /** The one or two slots this verdict is about. */
  slots: SlotId[];
  title: string;
  explanation: string;
  fix?: string;
  builder?: string;
  sources?: string[];
  missingFacts?: { optionId: string; fact: string }[];
}

export interface CatalogIndex {
  catalog: Catalog;
  optionsById: Map<string, Option>;
  needsById: Map<string, Need>;
  slotsById: Map<SlotId, SlotDef>;
}

export function indexCatalog(catalog: Catalog): CatalogIndex {
  return {
    catalog,
    optionsById: new Map(catalog.options.map((o) => [o.id, o])),
    needsById: new Map(catalog.needs.map((n) => [n.id, n])),
    slotsById: new Map(catalog.slots.map((s) => [s.id, s])),
  };
}

export function needIsOn(index: CatalogIndex, input: PlanInput, needId: string): boolean {
  const need = index.needsById.get(needId);
  if (!need) return false;
  if (need.only_if && !needIsOn(index, input, need.only_if)) return false;
  return input.answers[needId] === "yes";
}

export function optionIn(index: CatalogIndex, selection: Selection, slot: SlotId): Option | undefined {
  const id = selection[slot];
  return id ? index.optionsById.get(id) : undefined;
}

export type FactRead = { known: true; value: FactValue } | { known: false };

/**
 * A fact is unknown when it is missing, or null where null is not a real answer. For a price,
 * null means "no monthly plan", but only an option marked as fully researched gets that benefit
 * of the doubt; on a partial option it stays unknown, so an unverified price never reads as $0.
 */
export function readFact(index: CatalogIndex, option: Option, factKey: string): FactRead {
  const fact = option.facts[factKey];
  if (!fact) return { known: false };
  if (fact.value === null) {
    const def = index.catalog.facts[factKey];
    return def?.type === "number_or_null" && option.coverage === "full" ? { known: true, value: null } : { known: false };
  }
  return { known: true, value: fact.value };
}

/** The slots a capability rule reads, in canonical slot order, including slots it only checks for emptiness. */
export function ruleSlots(rule: CapabilityRule): SlotId[] {
  const used = new Set<SlotId>();
  for (const c of rule.when) {
    used.add(c.slot);
    if (c.key_from_slot) used.add(c.key_from_slot);
  }
  return SLOT_IDS.filter((s) => used.has(s));
}

/** The slots a rule reads facts from. A rule only applies once all of these are filled. */
export function factSlots(rule: CapabilityRule): SlotId[] {
  const used = new Set<SlotId>();
  for (const c of rule.when) {
    if (c.filled !== undefined) continue;
    used.add(c.slot);
    if (c.key_from_slot) used.add(c.key_from_slot);
  }
  return SLOT_IDS.filter((s) => used.has(s));
}

type ConditionOutcome = { kind: "true" } | { kind: "false" } | { kind: "unknown"; optionId: string; fact: string };

function evaluateCondition(index: CatalogIndex, selection: Selection, condition: Condition): ConditionOutcome {
  const option = optionIn(index, selection, condition.slot);
  if (condition.filled !== undefined) return { kind: Boolean(option) === condition.filled ? "true" : "false" };
  if (!option || !condition.fact) return { kind: "false" };

  const read = readFact(index, option, condition.fact);
  if (!read.known) return { kind: "unknown", optionId: option.id, fact: condition.fact };

  let value: FactValue | undefined = read.value;
  if (condition.key_from_slot) {
    const keyId = selection[condition.key_from_slot];
    const map = value;
    value = map && typeof map === "object" && keyId ? map[keyId] : undefined;
    if (value === undefined) {
      return { kind: "unknown", optionId: option.id, fact: `${condition.fact}.${keyId}` };
    }
  }

  let matches: boolean;
  if (condition.is !== undefined) matches = value === condition.is;
  else if (condition.in !== undefined) matches = condition.in.some((v) => v === value);
  else matches = value !== condition.not;
  return { kind: matches ? "true" : "false" };
}

/** Replace {slot} placeholders with the name of the option in that slot. */
export function fillTemplate(index: CatalogIndex, selection: Selection, text: string): string {
  return text.replace(/\{(\w+)\}/g, (whole, slot: string) => {
    if (!(SLOT_IDS as readonly string[]).includes(slot)) return whole;
    const option = optionIn(index, selection, slot as SlotId);
    return option ? option.name : (index.slotsById.get(slot as SlotId)?.label.toLowerCase() ?? slot);
  });
}

function factLabel(index: CatalogIndex, fact: string): string {
  const [key, sub] = fact.split(".");
  const label = index.catalog.facts[key]?.label ?? key;
  const subName = sub ? index.optionsById.get(sub)?.name ?? sub : undefined;
  return subName ? `${label} for ${subName}` : label;
}

export function evaluateCapabilityRule(
  index: CatalogIndex,
  selection: Selection,
  input: PlanInput,
  rule: CapabilityRule,
): CheckResult | null {
  if (!rule.needs.every((n) => needIsOn(index, input, n))) return null;
  if (!factSlots(rule).every((s) => optionIn(index, selection, s))) return null;
  const slots = ruleSlots(rule);

  const outcomes = rule.when.map((c) => evaluateCondition(index, selection, c));
  if (outcomes.some((o) => o.kind === "false")) return null;

  const key = `${rule.id}:${slots.map((s) => selection[s] || "empty").join("+")}`;
  const fill = (text: string) => fillTemplate(index, selection, text);
  const unknown = outcomes.filter((o): o is Extract<ConditionOutcome, { kind: "unknown" }> => o.kind === "unknown");

  if (unknown.length > 0) {
    // Phrase it as the gap, not as the rule's conclusion: nothing is known to be wrong yet.
    const byOption = new Map<string, string[]>();
    for (const u of unknown) byOption.set(u.optionId, [...(byOption.get(u.optionId) ?? []), factLabel(index, u.fact).toLowerCase()]);
    const gaps = [...byOption.entries()].map(([id, facts]) => `${index.optionsById.get(id)?.name ?? id} yet: ${facts.join(", ")}`);
    return {
      key,
      ruleId: rule.id,
      source: "capability",
      level: "unknown",
      slots,
      title: `Can't check ${gaps.join("; ")}`,
      explanation: `This check needs a fact that hasn't been researched, so WhyStack can't say whether the combination works. It never assumes a missing fact means "works". The check it would run: ${fill(rule.title).replace(/\.$/, "")}.`,
      missingFacts: unknown.map((u) => ({ optionId: u.optionId, fact: u.fact })),
    };
  }

  return {
    key,
    ruleId: rule.id,
    source: "capability",
    level: rule.severity,
    slots,
    title: fill(rule.title),
    explanation: fill(rule.explanation),
    fix: rule.fix ? fill(rule.fix) : undefined,
    builder: rule.builder ? fill(rule.builder) : undefined,
    sources: rule.sources,
  };
}

export function evaluateProductRule(
  index: CatalogIndex,
  selection: Selection,
  input: PlanInput,
  rule: ProductRule,
): CheckResult | null {
  if (!rule.needs.every((n) => needIsOn(index, input, n))) return null;
  if (!rule.pair.every((p) => selection[p.slot] === p.option)) return null;
  const slots = SLOT_IDS.filter((s) => rule.pair.some((p) => p.slot === s));
  const fill = (text: string) => fillTemplate(index, selection, text);
  return {
    key: `${rule.id}`,
    ruleId: rule.id,
    source: "product",
    level: rule.severity,
    slots,
    title: fill(rule.title),
    explanation: fill(rule.explanation),
    fix: rule.fix ? fill(rule.fix) : undefined,
    builder: rule.builder ? fill(rule.builder) : undefined,
    sources: rule.sources,
  };
}

/** Slots the confirmed answers call for. Framework and hosting are always needed. */
export function neededSlots(index: CatalogIndex, input: PlanInput): SlotId[] {
  const needed = new Set<SlotId>(["framework", "hosting"]);
  for (const need of index.catalog.needs) {
    if (needIsOn(index, input, need.id)) need.adds_slots.forEach((s) => needed.add(s));
  }
  return SLOT_IDS.filter((s) => needed.has(s));
}

function missingPieces(index: CatalogIndex, selection: Selection, input: PlanInput): CheckResult[] {
  const reasons = new Map<SlotId, string[]>();
  for (const need of index.catalog.needs) {
    if (!needIsOn(index, input, need.id)) continue;
    for (const slot of need.adds_slots) {
      if (optionIn(index, selection, slot)) continue;
      reasons.set(slot, [...(reasons.get(slot) ?? []), need.label.toLowerCase()]);
    }
  }
  return [...reasons.entries()].map(([slot, needs]) => {
    const label = index.slotsById.get(slot)?.label ?? slot;
    return {
      key: `missing:${slot}`,
      ruleId: `missing-${slot}`,
      source: "missing" as const,
      level: "missing" as const,
      slots: [slot],
      title: `Nothing is in ${label}`,
      explanation: `You said your app has: ${needs.join(", ")}. That needs something in ${label}.`,
      fix: `Drag an option into ${label}, or change your answer if you don't need it.`,
    };
  });
}

function coverageNotes(index: CatalogIndex, selection: Selection): CheckResult[] {
  const results: CheckResult[] = [];
  for (const slot of SLOT_IDS) {
    const option = optionIn(index, selection, slot);
    if (!option || option.coverage === "full") continue;
    results.push({
      key: `coverage:${option.id}`,
      ruleId: "coverage",
      source: "coverage",
      level: "unknown",
      slots: [slot],
      title: `${option.name} isn't verified yet`,
      explanation: `${option.name}'s facts haven't been researched, so its connections and costs can't be checked. You can still plan with it; every check it touches is marked "not verified yet".`,
    });
  }
  return results;
}

export function levelRank(level: Level): number {
  return LEVEL_ORDER.indexOf(level);
}

export function evaluatePlan(
  index: CatalogIndex,
  selection: Selection,
  input: PlanInput,
): CheckResult[] {
  const results: CheckResult[] = [];
  const seenUnknown = new Set<string>();

  for (const rule of index.catalog.capabilityRules) {
    const result = evaluateCapabilityRule(index, selection, input, rule);
    if (!result) continue;
    if (result.level === "unknown") {
      // Two rules waiting on the same missing fact say the same thing; show it once.
      const signature = `${result.slots.join("+")}|${(result.missingFacts ?? []).map((m) => `${m.optionId}.${m.fact}`).join(",")}`;
      if (seenUnknown.has(signature)) continue;
      seenUnknown.add(signature);
    }
    results.push(result);
  }
  for (const rule of index.catalog.productRules) {
    const result = evaluateProductRule(index, selection, input, rule);
    if (result) results.push(result);
  }
  results.push(...missingPieces(index, selection, input), ...coverageNotes(index, selection));

  return results.sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.key.localeCompare(b.key));
}

/** The most serious non-note level among results, or "works". */
export function worstLevel(results: CheckResult[]): Level | "works" {
  const serious = results.filter((r) => r.level !== "info");
  if (serious.length === 0) return "works";
  return serious.reduce((worst, r) => (levelRank(r.level) < levelRank(worst) ? r.level : worst), serious[0].level);
}
