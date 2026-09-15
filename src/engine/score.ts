import {
  evaluateCapabilityRule,
  evaluatePlan,
  evaluateProductRule,
  needIsOn,
  neededSlots,
  optionIn,
  readFact,
  ruleSlots,
  worstLevel,
  type CatalogIndex,
  type CheckResult,
  type Level,
} from "./evaluate";
import {
  SIZE_IDS,
  SLOT_IDS,
  type CapabilityRule,
  type Option,
  type PlanInput,
  type PriorityId,
  type Selection,
  type SlotId,
  type Weights,
} from "./schema";

/**
 * Ranking. The rules say what works; scoring picks among what works. Every number comes from a
 * fact and a published weight in data/planning.json, so a recommendation can always be explained
 * criterion by criterion, and the same answers always produce the same plan.
 */

export const CRITERIA = ["cost", "price", "setup", "portability"] as const;
export type Criterion = (typeof CRITERIA)[number];

export const CRITERION_LABELS: Record<Criterion | "accounts", string> = {
  cost: "free at your size",
  price: "cheaper paid plan",
  setup: "fewer setup steps",
  portability: "easier to switch away from",
  accounts: "fewer accounts to manage",
};

/**
 * Domains are never free, so their cost criteria compare the first year and the renewal instead.
 * Payment services have no monthly plan, so their price criterion compares the fee on a sale.
 */
export function criterionLabel(criterion: Criterion | "accounts", slot?: SlotId): string {
  if (slot === "domain" && criterion === "cost") return "cheaper for the first year";
  if (slot === "domain" && criterion === "price") return "cheaper to renew";
  if (slot === "payments" && criterion === "price") return "cheaper per sale";
  return CRITERION_LABELS[criterion];
}

/** The sale used to compare payment fees: a percent matters more on big sales, a fixed fee on small ones. */
export const TYPICAL_SALE_USD = 20;

const SIZE_RANK: Record<string, number> = { none: 0, just_me: 1, up_to_100: 2, up_to_1000: 3, more: 4 };
const UNKNOWN_SCORE = 0.25;
const BLOCKED_PENALTY = 1000;
const MISSING_PENALTY = 3;

export function weightsFor(index: CatalogIndex, priority: PriorityId): Weights {
  const found = index.catalog.planning.priorities.find((p) => p.id === priority);
  if (!found) throw new Error(`Unknown priority ${priority}`);
  return found.weights;
}

/** Does this option's free plan cover the beginner's size? null when a fact is unverified. */
export function freePlanFits(index: CatalogIndex, option: Option, slot: SlotId, input: PlanInput): boolean | null {
  const covers = readFact(index, option, "free_plan_covers");
  if (!covers.known || typeof covers.value !== "string") return null;
  if (slot === "hosting" && needIsOn(index, input, "users_pay")) {
    const commercial = readFact(index, option, "free_plan_commercial_use");
    if (!commercial.known) return null;
    if (commercial.value === false && covers.value !== "none") return false;
  }
  return (SIZE_RANK[covers.value] ?? 0) >= SIZE_RANK[input.size];
}

export function criterionScores(index: CatalogIndex, option: Option, slot: SlotId, input: PlanInput): Record<Criterion, number> {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  let cost = UNKNOWN_SCORE;
  let price = UNKNOWN_SCORE;
  if (slot === "domain") {
    const first = readFact(index, option, "com_first_year_usd");
    const renewal = readFact(index, option, "com_renewal_usd");
    if (first.known) cost = clamp(1 - Number(first.value) / 30);
    if (renewal.known) price = clamp(1 - Number(renewal.value) / 40);
  } else {
    const covers = readFact(index, option, "free_plan_covers");
    const fits = freePlanFits(index, option, slot, input);
    if (fits === true) cost = 1;
    else if (fits === false && covers.known && typeof covers.value === "string") {
      cost = SIZE_RANK[covers.value] === SIZE_RANK[input.size] - 1 ? 0.5 : 0;
    }
    const paid = readFact(index, option, "first_paid_usd_month");
    if (paid.known) price = paid.value === null ? 1 : clamp(1 - Number(paid.value) / 50);
  }
  if (slot === "payments") {
    const percent = readFact(index, option, "card_fee_percent");
    const fixed = readFact(index, option, "card_fee_fixed_usd");
    // The share of a typical sale the service keeps: 0% scores 1, 10% or more scores 0.
    price = percent.known && fixed.known ? clamp(1 - (Number(percent.value) / 100 + Number(fixed.value) / TYPICAL_SALE_USD) / 0.1) : UNKNOWN_SCORE;
  }

  const setup = option.coverage === "partial" && option.setup.length === 0 ? UNKNOWN_SCORE : 1 - Math.min(option.setup.length, 6) / 6;

  const portabilityRead = readFact(index, option, "portability");
  const portability = portabilityRead.known
    ? ({ high: 1, medium: 0.6, low: 0.2 } as Record<string, number>)[String(portabilityRead.value)] ?? UNKNOWN_SCORE
    : UNKNOWN_SCORE;

  return { cost, price, setup, portability };
}

function weighted(scores: Record<Criterion, number>, weights: Weights): number {
  return CRITERIA.reduce((sum, c) => sum + scores[c] * weights[c], 0);
}

/**
 * How a verdict moves a plan's score. Only a product rule's note is a perk worth a bonus (two
 * services built to work together). A capability rule's note is neutral: some are good news, some
 * are costs to know about ("downloads cost money"), and none should tip a ranking on their own.
 */
export function resultAdjustment(index: CatalogIndex, level: Level, source: CheckResult["source"]): number {
  const { penalties } = index.catalog.planning;
  switch (level) {
    case "blocked":
      return -BLOCKED_PENALTY;
    case "missing":
      return -MISSING_PENALTY;
    case "warning":
      return -penalties.warning;
    case "unknown":
      return -penalties.unknown;
    case "info":
      return source === "product" ? penalties.info_bonus : 0;
  }
}

function accountsSaved(index: CatalogIndex, selection: Selection): number {
  const providers: string[] = [];
  for (const slot of SLOT_IDS) {
    if (slot === "framework") continue;
    const option = optionIn(index, selection, slot);
    if (option && !index.catalog.planning.no_account_providers.includes(option.provider)) providers.push(option.provider);
  }
  return providers.length - new Set(providers).size;
}

export interface PlanScore {
  total: number;
  perSlot: Partial<Record<SlotId, { scores: Record<Criterion, number>; weighted: number }>>;
  accountsSaved: number;
  adjustments: number;
}

export function scorePlan(index: CatalogIndex, selection: Selection, input: PlanInput, results: CheckResult[]): PlanScore {
  const weights = weightsFor(index, input.priority);
  const perSlot: PlanScore["perSlot"] = {};
  let total = 0;
  for (const slot of SLOT_IDS) {
    const option = optionIn(index, selection, slot);
    if (!option) continue;
    const scores = criterionScores(index, option, slot, input);
    const w = weighted(scores, weights);
    perSlot[slot] = { scores, weighted: w };
    total += w;
  }
  const saved = accountsSaved(index, selection);
  const adjustments = results.filter((r) => r.source !== "coverage").reduce((sum, r) => sum + resultAdjustment(index, r.level, r.source), 0);
  total += saved * weights.accounts + adjustments;
  return { total, perSlot, accountsSaved: saved, adjustments };
}

export interface Recommendation {
  selection: Selection;
  results: CheckResult[];
  score: PlanScore;
  needed: SlotId[];
  /** Slots WhyStack filled, as opposed to ones the person chose. */
  autoPicked: SlotId[];
}

/**
 * Find the best-scoring plan. Pinned slots stay as the person set them (an empty string keeps a
 * slot empty); every other needed slot is searched over fully researched options only, because
 * WhyStack never recommends something it can't verify. Branch and bound keeps this fast: a
 * partial plan is dropped as soon as even its best possible finish can't beat the best plan found.
 */
export function recommend(index: CatalogIndex, input: PlanInput, pinned: Selection = {}): Recommendation {
  const weights = weightsFor(index, input.priority);
  const needed = neededSlots(index, input);
  const wanted = SLOT_IDS.filter((s) => needed.includes(s) || Boolean(pinned[s]));

  const order: SlotId[] = [];
  const candidates = new Map<SlotId, Option[]>();
  for (const slot of wanted) {
    if (pinned[slot] === "") continue;
    const list = pinned[slot]
      ? [index.optionsById.get(pinned[slot]!)].filter((o): o is Option => Boolean(o))
      : index.catalog.options.filter((o) => o.coverage === "full" && o.slots.includes(slot));
    if (list.length === 0) continue;
    order.push(slot);
    candidates.set(slot, list);
  }

  // Classify each rule by the slots it reads that are part of this search. A slot outside the
  // search is empty in every candidate plan, so a rule that also checks that slot is still a
  // one-slot (or two-slot) rule here, and a rule touching no searched slot is the same for all.
  const searched = (rule: CapabilityRule) => ruleSlots(rule).filter((s) => order.includes(s));
  const unaryRules = index.catalog.capabilityRules.filter((r) => searched(r).length === 1);
  const pairRules = index.catalog.capabilityRules.filter((r) => searched(r).length === 2);

  const unary = new Map<string, number>();
  for (const slot of order) {
    for (const option of candidates.get(slot)!) {
      const selection: Selection = { [slot]: option.id };
      let value = weighted(criterionScores(index, option, slot, input), weights);
      for (const rule of unaryRules) {
        if (searched(rule)[0] !== slot) continue;
        const result = evaluateCapabilityRule(index, selection, input, rule);
        if (result) value += resultAdjustment(index, result.level, result.source);
      }
      unary.set(`${slot}:${option.id}`, value);
    }
    candidates.get(slot)!.sort((a, b) => unary.get(`${slot}:${b.id}`)! - unary.get(`${slot}:${a.id}`)! || a.id.localeCompare(b.id));
  }

  const pairValue = new Map<string, number>();
  const pairMax = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const [a, b] = [order[i], order[j]];
      let max = -Infinity;
      for (const oa of candidates.get(a)!) {
        for (const ob of candidates.get(b)!) {
          const selection: Selection = { [a]: oa.id, [b]: ob.id };
          let value = 0;
          for (const rule of pairRules) {
            const slots = searched(rule);
            if (slots[0] !== a || slots[1] !== b) continue;
            const result = evaluateCapabilityRule(index, selection, input, rule);
            if (result) value += resultAdjustment(index, result.level, result.source);
          }
          for (const rule of index.catalog.productRules) {
            const result = evaluateProductRule(index, selection, input, rule);
            if (result) value += resultAdjustment(index, result.level, result.source);
          }
          pairValue.set(`${a}:${oa.id}|${b}:${ob.id}`, value);
          max = Math.max(max, value);
        }
      }
      pairMax.set(`${a}|${b}`, max);
    }
  }

  // A shared account is counted when the second part from the same provider is placed, so the
  // running total is exact at every step. A slot can only add that bonus if one of its candidates
  // shares a provider with a candidate in an earlier slot.
  const noAccount = new Set(index.catalog.planning.no_account_providers);
  const accountOf = (slot: SlotId, option: Option) => (slot === "framework" || noAccount.has(option.provider) ? null : option.provider);
  const accountGain = Math.max(0, weights.accounts);
  const canShare = order.map((slot, i) => {
    const earlier = new Set(order.slice(0, i).flatMap((s) => candidates.get(s)!.map((o) => accountOf(s, o))));
    return candidates.get(slot)!.some((o) => accountOf(slot, o) !== null && earlier.has(accountOf(slot, o)));
  });

  // Optimistic bound for everything not yet chosen.
  const remainingBound: number[] = new Array(order.length + 1).fill(0);
  for (let depth = order.length - 1; depth >= 0; depth--) {
    const slot = order[depth];
    const bestUnary = Math.max(...candidates.get(slot)!.map((o) => unary.get(`${slot}:${o.id}`)!));
    let pairs = 0;
    for (let k = 0; k < depth; k++) pairs += pairMax.get(`${order[k]}|${slot}`)!;
    remainingBound[depth] = remainingBound[depth + 1] + bestUnary + pairs + (canShare[depth] ? accountGain : 0);
  }

  // Candidates are tried best first, so among plans that tie exactly, the first one found wins.
  let best: { total: number; choice: Option[] } = { total: -Infinity, choice: [] };
  const choice: Option[] = [];
  const accounts = new Map<string, number>();

  const search = (depth: number, partial: number) => {
    if (depth === order.length) {
      if (partial > best.total + 1e-9) best = { total: partial, choice: [...choice] };
      return;
    }
    if (partial + remainingBound[depth] <= best.total + 1e-9) return;
    const slot = order[depth];
    for (const option of candidates.get(slot)!) {
      let add = unary.get(`${slot}:${option.id}`)!;
      for (let k = 0; k < depth; k++) add += pairValue.get(`${order[k]}:${choice[k].id}|${slot}:${option.id}`)!;
      const account = accountOf(slot, option);
      if (account !== null) {
        const seen = accounts.get(account) ?? 0;
        if (seen > 0) add += weights.accounts;
        accounts.set(account, seen + 1);
      }
      choice.push(option);
      search(depth + 1, partial + add);
      choice.pop();
      if (account !== null) accounts.set(account, accounts.get(account)! - 1);
    }
  };
  search(0, 0);

  const selection: Selection = {};
  for (const slot of SLOT_IDS) if (pinned[slot] === "") selection[slot] = "";
  order.forEach((slot, i) => {
    selection[slot] = best.choice[i]?.id;
  });

  const results = evaluatePlan(index, selection, input);
  return {
    selection,
    results,
    score: scorePlan(index, selection, input, results),
    needed,
    autoPicked: order.filter((s) => !pinned[s]),
  };
}

export interface Alternative {
  option: Option;
  total: number;
  delta: number;
  worst: Level | "works";
  scores: Record<Criterion, number>;
  results: CheckResult[];
}

/** Every option that fits a slot, scored as if swapped in with the rest of the plan unchanged. */
export function alternativesFor(index: CatalogIndex, input: PlanInput, selection: Selection, slot: SlotId): Alternative[] {
  const current = scorePlan(index, selection, input, evaluatePlan(index, selection, input)).total;
  return index.catalog.options
    .filter((o) => o.slots.includes(slot))
    .map((option) => {
      const swapped: Selection = { ...selection, [slot]: option.id };
      const results = evaluatePlan(index, swapped, input);
      const total = scorePlan(index, swapped, input, results).total;
      const touching = results.filter((r) => r.slots.includes(slot));
      return {
        option,
        total,
        delta: total - current,
        worst: worstLevel(touching),
        scores: criterionScores(index, option, slot, input),
        results: touching,
      };
    })
    .sort((a, b) => {
      const blocked = Number(a.worst === "blocked") - Number(b.worst === "blocked");
      const verified = Number(a.option.coverage === "partial") - Number(b.option.coverage === "partial");
      return blocked || verified || b.total - a.total || a.option.id.localeCompare(b.option.id);
    });
}

export interface CloseCall {
  slot: SlotId;
  chosen: Option;
  runnerUp: Option;
  margin: number;
  /**
   * What separates them most in the chosen option's favor: a criterion, sharing an account with
   * another slot, fewer problems or a perk with the rest of the plan, some other mix of checks,
   * or nothing at all (a tie broken alphabetically).
   */
  decidedBy: Criterion | "accounts" | "fewer_problems" | "perks" | "checks" | "tie";
  /** The perk's title when decidedBy is "perks". */
  perk?: string;
  /** A priority under which the runner-up would win, if any. */
  flipsUnder?: PriorityId;
}

export function closeCalls(index: CatalogIndex, input: PlanInput, recommendation: Recommendation): CloseCall[] {
  const calls: CloseCall[] = [];
  const weights = weightsFor(index, input.priority);
  for (const slot of recommendation.autoPicked) {
    const chosen = optionIn(index, recommendation.selection, slot);
    if (!chosen) continue;
    const alts = alternativesFor(index, input, recommendation.selection, slot).filter(
      (a) => a.option.id !== chosen.id && a.option.coverage === "full" && a.worst !== "blocked",
    );
    const runner = alts[0];
    if (!runner) continue;
    const margin = Math.abs(runner.delta) < 1e-9 ? 0 : -runner.delta;
    if (margin > index.catalog.planning.close_call_margin) continue;

    const chosenScores = criterionScores(index, chosen, slot, input);
    let decidedBy: CloseCall["decidedBy"] = margin <= 1e-9 ? "tie" : "checks";
    let biggest = 0;
    for (const c of CRITERIA) {
      const gap = (chosenScores[c] - runner.scores[c]) * weights[c];
      if (gap > biggest + 1e-9) {
        biggest = gap;
        decidedBy = c;
      }
    }
    const swapped: Selection = { ...recommendation.selection, [slot]: runner.option.id };
    const accountGap = (accountsSaved(index, recommendation.selection) - accountsSaved(index, swapped)) * weights.accounts;
    if (accountGap > biggest + 1e-9) decidedBy = "accounts";

    let perk: string | undefined;
    if (decidedBy === "checks") {
      const chosenResults = recommendation.results.filter((r) => r.slots.includes(slot));
      const problems = (results: CheckResult[]) => results.filter((r) => r.level !== "info").length;
      const extraPerk = chosenResults.find((r) => r.level === "info" && r.source === "product" && !runner.results.some((q) => q.ruleId === r.ruleId));
      if (problems(chosenResults) < problems(runner.results)) decidedBy = "fewer_problems";
      else if (extraPerk) {
        decidedBy = "perks";
        perk = extraPerk.title;
      }
    }

    const flipsUnder = index.catalog.planning.priorities
      .map((p) => p.id)
      .filter((p) => p !== input.priority)
      .find((priority) => {
        const alt = { ...input, priority };
        const a = scorePlan(index, recommendation.selection, alt, evaluatePlan(index, recommendation.selection, alt)).total;
        const b = scorePlan(index, swapped, alt, evaluatePlan(index, swapped, alt)).total;
        return b > a + 1e-9;
      });

    calls.push({ slot, chosen, runnerUp: runner.option, margin, decidedBy, perk, flipsUnder });
  }
  return calls;
}

export function nextSize(size: PlanInput["size"]): PlanInput["size"] | null {
  const i = SIZE_IDS.indexOf(size);
  return i >= 0 && i < SIZE_IDS.length - 1 ? SIZE_IDS[i + 1] : null;
}
