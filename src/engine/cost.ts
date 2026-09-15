import { needIsOn, optionIn, readFact, type CatalogIndex } from "./evaluate";
import { freePlanFits, nextSize } from "./score";
import { SLOT_IDS, type Option, type PlanInput, type Selection, type SizeId, type SlotId } from "./schema";

/**
 * Cost at the level a beginner needs: is it free at my size, and what is the first bill when it
 * isn't? Every line comes from a sourced fact. An unverified price is shown as unverified, never
 * as $0.
 */

export type CostKind = "free" | "paid" | "usage" | "unknown";

export interface CostLine {
  slot: SlotId;
  option: Option;
  kind: CostKind;
  monthlyUsd: number;
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
  return { slot, option, kind: "unknown", monthlyUsd: 0, headline };
}

export function costLine(index: CatalogIndex, option: Option, slot: SlotId, input: PlanInput): CostLine {
  if (slot === "framework") {
    return option.coverage === "full"
      ? { slot, option, kind: "free", monthlyUsd: 0, headline: "Free and open source", ...withFact(option, "free_plan_covers") }
      : unknown(slot, option, "Cost not verified yet");
  }

  if (slot === "payments") {
    const fee = readFact(index, option, "fee_summary");
    if (!fee.known) return unknown(slot, option, "Fees not verified yet");
    return { slot, option, kind: "usage", monthlyUsd: 0, headline: `Pay per sale: ${fee.value}`, ...withFact(option, "fee_summary") };
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
      headline: freeTier.value === true ? "Free tier to start, then pay per use" : "Pay per use from the first request",
      detail: String(price.value),
      source: option.facts.cheap_model_price?.source,
      retrieved: option.facts.cheap_model_price?.retrieved,
    };
  }

  const fits = freePlanFits(index, option, slot, input);
  if (fits === null) return unknown(slot, option, "Not verified yet");
  if (fits) return { slot, option, kind: "free", monthlyUsd: 0, headline: "Free at your size", ...withFact(option, "free_plan_covers") };

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
    return { slot, option, kind: "usage", monthlyUsd: 0, headline: "Pay as you go", detail: `${reason} ${fact?.note ?? ""}`.trim(), source: fact?.source, retrieved: fact?.retrieved };
  }
  return {
    slot,
    option,
    kind: "paid",
    monthlyUsd: Number(paid.value),
    headline: `About $${paid.value}/month`,
    detail: `${reason} ${fact?.note ?? ""}`.trim(),
    source: fact?.source,
    retrieved: fact?.retrieved,
  };
}

export interface CostSummary {
  size: SizeId;
  lines: CostLine[];
  monthlyUsd: number;
  hasUsage: boolean;
  hasUnknown: boolean;
}

export function costSummary(index: CatalogIndex, selection: Selection, input: PlanInput): CostSummary {
  const lines = SLOT_IDS.flatMap((slot) => {
    const option = optionIn(index, selection, slot);
    return option ? [costLine(index, option, slot, input)] : [];
  });
  return {
    size: input.size,
    lines,
    monthlyUsd: lines.reduce((sum, l) => sum + l.monthlyUsd, 0),
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

export function describeTotal(summary: CostSummary): string {
  const base = `about $${summary.monthlyUsd}/month`;
  const extras = [summary.hasUsage ? "plus usage" : "", summary.hasUnknown ? "some prices not verified yet" : ""].filter(Boolean);
  return extras.length ? `${base}, ${extras.join(", ")}` : base;
}
