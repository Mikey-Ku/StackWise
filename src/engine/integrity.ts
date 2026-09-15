import { evaluateCapabilityRule, indexCatalog, ruleSlots } from "./evaluate";
import type { Catalog, FactDef, FactValue, PlanInput, Selection } from "./schema";

/**
 * Cross-file checks the schemas alone can't express. The data tests fail on any problem listed
 * here, which is how "full" stays honest: an option that claims full coverage must have every
 * fact its slots need, and every pair of fully covered options must get a real verdict.
 */

function valueMatches(def: FactDef, value: FactValue, frameworkIds: string[]): boolean {
  if (value === null) return true; // null is "unverified"; coverage rules decide whether that's allowed
  switch (def.type) {
    case "enum":
      return typeof value === "string" && (def.values ?? []).includes(value);
    case "boolean":
      return typeof value === "boolean";
    case "number_or_null":
      return typeof value === "number" && value >= 0;
    case "string":
      return typeof value === "string" && value.length > 0;
    case "framework_map":
      return (
        typeof value === "object" &&
        Object.entries(value).every(([k, v]) => frameworkIds.includes(k) && (def.values ?? []).includes(v))
      );
  }
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

export function checkCatalog(catalog: Catalog): string[] {
  const problems: string[] = [];
  const index = indexCatalog(catalog);
  const needIds = new Set(catalog.needs.map((n) => n.id));
  const frameworkIds = catalog.options.filter((o) => o.slots.includes("framework")).map((o) => o.id);

  const seen = new Set<string>();
  for (const option of catalog.options) {
    if (seen.has(option.id)) problems.push(`duplicate option id ${option.id}`);
    seen.add(option.id);

    for (const [key, fact] of Object.entries(option.facts)) {
      const def = catalog.facts[key];
      if (!def) {
        problems.push(`${option.id}: unknown fact "${key}"`);
        continue;
      }
      if (!valueMatches(def, fact.value, frameworkIds)) {
        problems.push(`${option.id}: fact "${key}" has an invalid value ${JSON.stringify(fact.value)}`);
      }
    }

    if (option.coverage === "full") {
      for (const slot of option.slots) {
        const required = index.slotsById.get(slot)?.required_facts ?? [];
        for (const key of required) {
          const fact = option.facts[key];
          if (!fact) problems.push(`${option.id}: claims full coverage but is missing "${key}" for ${slot}`);
          else if (fact.value === null && catalog.facts[key]?.type !== "number_or_null") {
            problems.push(`${option.id}: claims full coverage but "${key}" is unverified (null)`);
          }
        }
        if (slot === "hosting") {
          const map = option.facts.framework_support?.value;
          for (const fw of catalog.options.filter((o) => o.coverage === "full" && o.slots.includes("framework"))) {
            if (!map || typeof map !== "object" || !(fw.id in map)) {
              problems.push(`${option.id}: claims full coverage but framework_support has no entry for ${fw.id}`);
            }
          }
        }
      }
    }

    for (const text of strings(option)) {
      if (text.includes("—")) problems.push(`${option.id}: contains an em dash`);
    }
  }

  for (const rule of catalog.capabilityRules) {
    const slots = ruleSlots(rule);
    if (slots.length > 2) problems.push(`rule ${rule.id}: reads ${slots.length} slots; rules may read at most two`);
    for (const need of rule.needs) if (!needIds.has(need)) problems.push(`rule ${rule.id}: unknown need "${need}"`);
    for (const c of rule.when) {
      const def = catalog.facts[c.fact];
      if (!def) {
        problems.push(`rule ${rule.id}: unknown fact "${c.fact}"`);
        continue;
      }
      if (!index.slotsById.get(c.slot)?.required_facts.includes(c.fact)) {
        problems.push(`rule ${rule.id}: "${c.fact}" is not a required fact for ${c.slot}, so full coverage wouldn't guarantee it`);
      }
      const compared = [c.is, c.not, ...(c.in ?? [])].filter((v) => v !== undefined);
      for (const v of compared) {
        if (def.type === "enum" && !(def.values ?? []).includes(String(v))) problems.push(`rule ${rule.id}: "${v}" is not a value of ${c.fact}`);
        if (def.type === "framework_map" && !(def.values ?? []).includes(String(v))) problems.push(`rule ${rule.id}: "${v}" is not a support level`);
        if (def.type === "boolean" && typeof v !== "boolean") problems.push(`rule ${rule.id}: ${c.fact} compares against a non-boolean`);
      }
    }
  }

  for (const rule of catalog.productRules) {
    for (const need of rule.needs) if (!needIds.has(need)) problems.push(`product rule ${rule.id}: unknown need "${need}"`);
    if (rule.pair[0].slot === rule.pair[1].slot) problems.push(`product rule ${rule.id}: both sides use the same slot`);
    for (const side of rule.pair) {
      const option = index.optionsById.get(side.option);
      if (!option) problems.push(`product rule ${rule.id}: unknown option "${side.option}"`);
      else if (!option.slots.includes(side.slot)) problems.push(`product rule ${rule.id}: ${side.option} doesn't fit ${side.slot}`);
    }
  }

  for (const need of catalog.needs) {
    if (need.only_if && !needIds.has(need.only_if)) problems.push(`need ${need.id}: only_if refers to unknown need "${need.only_if}"`);
  }

  for (const text of strings([catalog.needs, catalog.capabilityRules, catalog.productRules, catalog.slots, catalog.facts])) {
    if (text.includes("—")) problems.push(`rules or questions contain an em dash: "${text.slice(0, 60)}"`);
  }

  return problems;
}

/**
 * The "full" promise from the design: for every pair of fully covered options in different
 * slots, with every need switched on, no rule may come back "not verified yet".
 */
export function unverifiedPairs(catalog: Catalog): string[] {
  const index = indexCatalog(catalog);
  const input: PlanInput = {
    answers: Object.fromEntries(catalog.needs.map((n) => [n.id, "yes" as const])),
    size: "up_to_100",
    priority: "spend_zero",
  };
  const full = catalog.options.filter((o) => o.coverage === "full");
  const gaps: string[] = [];

  for (const rule of catalog.capabilityRules) {
    const slots = ruleSlots(rule);
    const [a, b] = slots;
    const listA = full.filter((o) => o.slots.includes(a));
    const listB = b ? full.filter((o) => o.slots.includes(b)) : [undefined];
    for (const oa of listA) {
      for (const ob of listB) {
        const selection: Selection = { [a]: oa.id, ...(b && ob ? { [b]: ob.id } : {}) };
        const result = evaluateCapabilityRule(index, selection, input, rule);
        if (result?.level === "unknown") gaps.push(`${rule.id}: ${[oa.id, ob?.id].filter(Boolean).join(" + ")}`);
      }
    }
  }
  return gaps;
}
