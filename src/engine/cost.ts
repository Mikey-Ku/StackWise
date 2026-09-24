import { needIsOn, optionIn, readFact, type CatalogIndex } from "./evaluate";
import { inSentence } from "./text";
import { freePlanFits, nextSize } from "./score";
import { SIZE_IDS, SLOT_IDS, type Fee, type Option, type PlanInput, type Selection, type SizeId, type SlotId } from "./schema";
import { isOwn } from "./own";

/**
 * Cost at the level a beginner needs: is it free at my size, and what is the first bill when it
 * isn't? Every line comes from a sourced fact. An unverified price is shown as unverified, never
 * as $0. Domains are billed yearly, and publishing a phone app has store fees, so those are
 * counted apart from the monthly total.
 */

export type CostKind = "free" | "paid" | "usage" | "yearly" | "unknown";

export interface CostLine {
  slot: SlotId;
  option: Option;
  kind: CostKind;
  monthlyUsd: number;
  /** Billed once a year, like a domain. */
  yearlyUsd: number;
  headline: string;
  detail?: string;
  source?: string;
  retrieved?: string;
}

const COVERS_LABEL: Record<string, string> = {
  none: "nobody (there is no free plan)",
  just_me: "just you",
  up_to_100: "up to 100 people",
  up_to_1000: "up to 1,000 people",
  more: "more than 1,000 people",
};

function withFact(option: Option, key: string): Pick<CostLine, "detail" | "source" | "retrieved"> {
  const fact = option.facts[key];
  return fact ? { detail: fact.note, source: fact.source, retrieved: fact.retrieved } : {};
}

function unknown(slot: SlotId, option: Option, headline: string): CostLine {
  return { slot, option, kind: "unknown", monthlyUsd: 0, yearlyUsd: 0, headline };
}

export function money(usd: number): string {
  return `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;
}

export function costLine(index: CatalogIndex, option: Option, slot: SlotId, input: PlanInput): CostLine {
  if (isOwn(option.id)) return unknown(slot, option, "Yours to run, not priced");
  if (slot === "framework") {
    return option.coverage === "full"
      ? { slot, option, kind: "free", monthlyUsd: 0, yearlyUsd: 0, headline: "Free and open source", ...withFact(option, "free_plan_covers") }
      : unknown(slot, option, "Cost not verified yet");
  }

  if (slot === "domain") {
    const first = readFact(index, option, "com_first_year_usd");
    const renewal = readFact(index, option, "com_renewal_usd");
    if (!first.known || !renewal.known) return unknown(slot, option, "Domain price not verified yet");
    const [firstUsd, renewalUsd] = [Number(first.value), Number(renewal.value)];
    return {
      slot,
      option,
      kind: "yearly",
      monthlyUsd: 0,
      yearlyUsd: firstUsd,
      headline: firstUsd === renewalUsd ? `About ${money(firstUsd)}/year for a .com` : `About ${money(firstUsd)} for a .com's first year, then ${money(renewalUsd)}/year`,
      ...withFact(option, "com_renewal_usd"),
    };
  }

  if (slot === "payments") {
    const fee = readFact(index, option, "fee_summary");
    if (!fee.known) return unknown(slot, option, "Fees not verified yet");
    return { slot, option, kind: "usage", monthlyUsd: 0, yearlyUsd: 0, headline: `Pay per sale: ${fee.value}`, ...withFact(option, "fee_summary") };
  }

  if (slot === "ai") {
    const freeTier = readFact(index, option, "free_tier");
    const price = readFact(index, option, "cheap_model_price");
    if (!freeTier.known || !price.known) return unknown(slot, option, "AI pricing not verified yet");
    return {
      slot,
      option,
      kind: "usage",
      monthlyUsd: 0,
      yearlyUsd: 0,
      headline: freeTier.value === true ? "Free tier to start, then pay per use" : "Pay per use from the first request",
      detail: String(price.value),
      source: option.facts.cheap_model_price?.source,
      retrieved: option.facts.cheap_model_price?.retrieved,
    };
  }

  const fits = freePlanFits(index, option, slot, input);
  if (fits === null) return unknown(slot, option, "Not verified yet");
  if (fits) return { slot, option, kind: "free", monthlyUsd: 0, yearlyUsd: 0, headline: "Free at your size", ...withFact(option, "free_plan_covers") };

  const covers = readFact(index, option, "free_plan_covers");
  const commercial = readFact(index, option, "free_plan_commercial_use");
  const commercialBlocked =
    slot === "hosting" && needIsOn(index, input, "users_pay") && commercial.known && commercial.value === false && covers.known && covers.value !== "none";
  const reason = commercialBlocked
    ? "The free plan doesn't allow charging customers."
    : `The free plan covers ${COVERS_LABEL[String(covers.known ? covers.value : "none")]}.`;

  const paid = readFact(index, option, "first_paid_usd_month");
  if (!paid.known) return { ...unknown(slot, option, "Paid plan price not verified yet"), detail: reason };
  const fact = option.facts.first_paid_usd_month;
  if (paid.value === null) {
    return { slot, option, kind: "usage", monthlyUsd: 0, yearlyUsd: 0, headline: "Pay as you go", detail: `${reason} ${fact?.note ?? ""}`.trim(), source: fact?.source, retrieved: fact?.retrieved };
  }
  return {
    slot,
    option,
    kind: "paid",
    monthlyUsd: Number(paid.value),
    yearlyUsd: 0,
    headline: `About ${money(Number(paid.value))}/month`,
    detail: `${reason} ${fact?.note ?? ""}`.trim(),
    source: fact?.source,
    retrieved: fact?.retrieved,
  };
}

export interface CostSummary {
  size: SizeId;
  lines: CostLine[];
  /** Fees that come with a part rather than an option, like app store accounts for a phone app. */
  fees: Fee[];
  monthlyUsd: number;
  yearlyUsd: number;
  oneTimeUsd: number;
  hasUsage: boolean;
  hasUnknown: boolean;
}

export function costSummary(index: CatalogIndex, selection: Selection, input: PlanInput): CostSummary {
  const lines = SLOT_IDS.flatMap((slot) => {
    const option = optionIn(index, selection, slot);
    return option ? [costLine(index, option, slot, input)] : [];
  });

  // One subscription can cover several parts: the same option in two slots, or a provider whose
  // single plan covers everything it fills. Count that plan once, on the first part that needs it.
  const sharedProviders = new Map(index.catalog.planning.shared_plans.map((plan) => [plan.provider, plan]));
  const planOwner = new Map<string, CostLine>();
  for (const line of lines) {
    if (line.kind !== "paid") continue;
    const key = sharedProviders.has(line.option.provider) ? `provider:${line.option.provider}` : `option:${line.option.id}`;
    const owner = planOwner.get(key);
    if (!owner) {
      planOwner.set(key, line);
      continue;
    }
    owner.monthlyUsd = Math.max(owner.monthlyUsd, line.monthlyUsd);
    const plan = sharedProviders.get(line.option.provider);
    Object.assign(line, {
      monthlyUsd: 0,
      headline: `Included in the plan counted for ${inSentence(index.slotsById.get(owner.slot)?.label ?? owner.slot)}`,
      detail: plan?.note ?? `${line.option.name} is one subscription for both parts.`,
      source: plan?.source ?? line.source,
    });
  }

  const fees = index.catalog.planning.fees.filter((fee) => optionIn(index, selection, fee.slot));
  const sum = (values: number[]) => Math.round(values.reduce((total, v) => total + v, 0) * 100) / 100;
  return {
    size: input.size,
    lines,
    fees,
    monthlyUsd: sum(lines.map((l) => l.monthlyUsd)),
    yearlyUsd: sum([...lines.map((l) => l.yearlyUsd), ...fees.filter((f) => f.per === "year").map((f) => f.usd)]),
    oneTimeUsd: sum(fees.filter((f) => f.per === "once").map((f) => f.usd)),
    hasUsage: lines.some((l) => l.kind === "usage"),
    hasUnknown: lines.some((l) => l.kind === "unknown"),
  };
}

/** Cost now, and at the next size up, so a beginner sees the first cliff before hitting it. */
export function costOutlook(index: CatalogIndex, selection: Selection, input: PlanInput) {
  const next = nextSize(input.size);
  return {
    now: costSummary(index, selection, input),
    next: next ? costSummary(index, selection, { ...input, size: next }) : null,
  };
}

/** The plan's cost at every audience size, to show where each free plan runs out. */
export function costBySize(index: CatalogIndex, selection: Selection, input: PlanInput): CostSummary[] {
  return SIZE_IDS.map((size) => costSummary(index, selection, { ...input, size }));
}

export function describeTotal(summary: CostSummary, { monthlyOnly = false } = {}): string {
  const base = `about ${money(summary.monthlyUsd)}/month`;
  const extras = [
    summary.hasUsage ? "plus usage" : "",
    !monthlyOnly && summary.yearlyUsd > 0 ? `plus ${money(summary.yearlyUsd)} a year` : "",
    !monthlyOnly && summary.oneTimeUsd > 0 ? `plus ${money(summary.oneTimeUsd)} once` : "",
    summary.hasUnknown ? "some prices not verified yet" : "",
  ].filter(Boolean);
  return extras.length ? `${base}, ${extras.join(", ")}` : base;
}
