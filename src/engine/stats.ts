import { buildChecklist } from "./checklist";
import { costBySize, costLine } from "./cost";
import { needIsOn, optionIn, readFact, worstLevel, type CatalogIndex, type Level } from "./evaluate";
import type { Recommendation } from "./score";
import { SLOT_IDS, type FactValue, type Option, type PlanInput, type SizeId, type SlotId } from "./schema";

/**
 * At-a-glance numbers for an option and for a whole plan. Every stat is read from a sourced fact
 * or computed from one, and an unverified fact shows as "Not verified", never as a guess. Stats
 * come most important first; cards show the first few that are known.
 */

export type StatTone = "good" | "neutral" | "warn" | "unknown";

export interface Stat {
  id: string;
  label: string;
  value: string;
  /** The same stat in a few words, for cards. */
  short: string;
  tone: StatTone;
  /** The fact's note, which names the real limit or number behind the value. */
  note?: string;
  /** The fact the stat is read from, when it comes from exactly one. */
  fact?: string;
}

const SIZE_RANK: Record<string, number> = { none: 0, just_me: 1, up_to_100: 2, up_to_1000: 3, more: 4 };

const FREE_PLAN: Record<string, [value: string, short: string]> = {
  none: ["No free plan", "No free plan"],
  just_me: ["Just you", "Free for just you"],
  up_to_100: ["Up to 100 people", "Free up to 100 people"],
  up_to_1000: ["Up to 1,000 people", "Free up to 1,000 people"],
  more: ["More than 1,000 people", "Free past 1,000 people"],
};

const SWITCHING: Record<string, [value: string, tone: StatTone]> = {
  high: ["Easy", "good"],
  medium: ["Some work", "neutral"],
  low: ["Hard", "warn"],
};

const RUNS_AS: Record<string, string> = { serverless: "Serverless functions", server: "Always-on server", edge: "Edge functions", static: "Static files only" };
const DATA_MODEL: Record<string, string> = { relational: "Tables (SQL)", document: "Documents", key_value: "Keys and values" };

/** An audience size as it reads mid-sentence: "free for just you", "$20/mo at up to 1,000 people". */
export const SIZE_PHRASE: Record<SizeId, string> = {
  just_me: "just you",
  up_to_100: "up to 100 people",
  up_to_1000: "up to 1,000 people",
  more: "more than 1,000 people",
};

export function money(usd: number): string {
  return `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;
}

export function optionStats(index: CatalogIndex, option: Option, slot: SlotId, input: PlanInput): Stat[] {
  const known = (key: string): { value: FactValue; note?: string } | null => {
    const read = readFact(index, option, key);
    return read.known ? { value: read.value, note: option.facts[key]?.note } : null;
  };
  const stat = (id: string, label: string, value: string, short: string, tone: StatTone, note?: string, fact?: string): Stat => ({
    id,
    label,
    value,
    short,
    tone,
    ...(note ? { note } : {}),
    ...(fact ? { fact } : {}),
  });
  const notVerified = (id: string, label: string): Stat => stat(id, label, "Not verified", "Not verified", "unknown");
  const flag = (key: string, label: string, yes: [string, string, StatTone], no: [string, string, StatTone], id = key): Stat | null => {
    const fact = known(key);
    if (!fact || typeof fact.value !== "boolean") return null;
    const [value, short, tone] = fact.value ? yes : no;
    return stat(id, label, value, short, tone, fact.note, key);
  };
  const text = (key: string, label: string, words: Record<string, string> = {}, id = key): Stat | null => {
    const fact = known(key);
    if (!fact || typeof fact.value !== "string") return null;
    const value = words[fact.value] ?? fact.value;
    return stat(id, label, value, value, "neutral", fact.note, key);
  };

  const now = (): Stat => {
    const label = "Cost at your size";
    if (slot === "payments") {
      const fee = known("fee_summary");
      return fee ? stat("now", "Fee per sale", String(fee.value), String(fee.value), "neutral", fee.note, "fee_summary") : notVerified("now", "Fee per sale");
    }
    const line = costLine(index, option, slot, input);
    if (line.kind === "unknown") return notVerified("now", label);
    if (line.kind === "free") return stat("now", label, "Free", "Free now", "good", line.detail);
    if (line.kind === "paid") return stat("now", label, `${money(line.monthlyUsd)}/mo`, `${money(line.monthlyUsd)}/mo now`, "warn", line.detail);
    if (slot === "ai") {
      const freeTier = known("free_tier")?.value === true;
      return freeTier ? stat("now", label, "Free tier, then pay per use", "Free tier to start", "good") : stat("now", label, "Pay per use", "Pay per use", "neutral");
    }
    return stat("now", label, "Pay as you go", "Pay as you go", "neutral", line.detail);
  };

  const paidFrom = (): Stat => {
    const label = "First paid plan";
    const paid = known("first_paid_usd_month");
    if (!paid) return notVerified("paidFrom", label);
    if (paid.value === null) return stat("paidFrom", label, "No monthly plan", "No monthly plan", "neutral", paid.note, "first_paid_usd_month");
    const price = `${money(Number(paid.value))}/mo`;
    return stat("paidFrom", label, price, `Paid from ${price}`, "neutral", paid.note, "first_paid_usd_month");
  };

  const freePlan = (): Stat => {
    const label = "Free plan covers";
    const covers = known("free_plan_covers");
    if (!covers || typeof covers.value !== "string" || !FREE_PLAN[covers.value]) return notVerified("freePlan", label);
    const [value, short] = FREE_PLAN[covers.value];
    const tone: StatTone = covers.value === "none" ? "warn" : SIZE_RANK[covers.value] >= SIZE_RANK[input.size] ? "good" : "neutral";
    const commercial = slot === "hosting" && covers.value !== "none" ? known("free_plan_commercial_use") : null;
    if (commercial?.value === false) {
      const charging = needIsOn(index, input, "users_pay");
      const note = `${covers.note ?? ""} ${commercial.note ?? ""}`.trim();
      return stat("freePlan", label, `${value}, not for apps that charge`, charging ? "Free plan not for paid apps" : `${short}, personal use`, charging ? "warn" : tone, note, "free_plan_covers");
    }
    return stat("freePlan", label, value, short, tone, covers.note, "free_plan_covers");
  };

  const switching = (): Stat => {
    const label = "Switching later";
    const portability = known("portability");
    const words = portability && SWITCHING[String(portability.value)];
    if (!portability || !words) return notVerified("switching", label);
    return stat("switching", label, words[0], `${words[0]} to switch`, words[1], portability.note, "portability");
  };

  const traits: (Stat | null)[] = (() => {
    switch (slot) {
      case "framework":
        return [text("language", "Language"), flag("has_server_code", "Server code", ["Built in", "Has server code", "neutral"], ["Browser only", "Browser only", "neutral"])];
      case "hosting":
        return [text("runtime_model", "Runs as", RUNS_AS)];
      case "database": {
        const model = text("data_model", "Data", DATA_MODEL);
        const live = known("realtime_built_in")?.value === true;
        return [model && live ? { ...model, value: `${model.value}, live updates`, short: `${model.short}, live` } : model];
      }
      case "login":
        return [flag("prebuilt_ui", "Sign-in screens", ["Ready-made", "Ready-made sign-in", "good"], ["Build your own", "Build your own sign-in", "neutral"])];
      case "files":
        return [flag("egress_fees", "Download fees", ["Yes", "Download fees", "warn"], ["None", "No download fees", "good"])];
      case "payments":
        return [flag("merchant_of_record", "Sales tax", ["Handled for you", "Handles sales tax", "good"], ["Your job", "You handle sales tax", "neutral"])];
      case "ai":
        return [text("cheap_model_price", "Cheapest model")];
      case "jobs":
        return [flag("long_running", "Long-running jobs", ["Supported", "Long jobs OK", "good"], ["Short jobs only", "Short jobs only", "neutral"])];
      case "email":
        return [];
      case "mobile":
        return [flag("needs_mac_for_ios", "iPhone builds", ["Need a Mac", "iPhone needs a Mac", "warn"], ["No Mac needed", "No Mac for iPhone", "good"]), text("language", "Language")];
    }
  })();

  const ordered: (Stat | null)[] =
    slot === "framework"
      ? [now(), ...traits, switching()]
      : slot === "payments"
        ? [now(), ...traits, paidFrom(), switching()]
        : slot === "ai"
          ? [now(), ...traits, paidFrom(), switching()]
          : [now(), paidFrom(), freePlan(), ...traits, switching()];
  return ordered.filter((s): s is Stat => s !== null);
}

/**
 * The stats worth a spot on a small card: the first few that are known, skipping a paid plan the
 * cost already implies ("$9/mo now" then "Paid from $9/mo", or "Pay as you go" then "No monthly plan").
 */
export function cardStats(stats: Stat[], count = 3): Stat[] {
  const now = stats.find((s) => s.id === "now");
  const implied = (s: Stat) =>
    s.id === "paidFrom" && now !== undefined && (s.value === now.value || (s.value === "No monthly plan" && ["Pay as you go", "Pay per use"].includes(now.value)));
  return stats.filter((s) => s.tone !== "unknown" && !implied(s)).slice(0, count);
}

export interface PlanStats {
  parts: number;
  accounts: number;
  setupSteps: number;
  problems: number;
  worst: Level | "works";
  now: { size: SizeId; monthlyUsd: number; hasUsage: boolean; hasUnknown: boolean };
  /** The smallest audience size where the plan costs more than it does now. */
  firstIncrease: { size: SizeId; monthlyUsd: number } | null;
  atLargest: { size: SizeId; monthlyUsd: number; hasUsage: boolean; hasUnknown: boolean };
}

export function planStats(index: CatalogIndex, input: PlanInput, rec: Recommendation): PlanStats {
  const filled = SLOT_IDS.flatMap((slot) => {
    const option = optionIn(index, rec.selection, slot);
    return option ? [{ slot, option }] : [];
  });
  const providers = filled
    .filter(({ slot, option }) => slot !== "framework" && !index.catalog.planning.no_account_providers.includes(option.provider))
    .map(({ option }) => option.provider);

  const sizes = costBySize(index, rec.selection, input);
  const at = sizes.findIndex((s) => s.size === input.size);
  const now = sizes[at];
  const firstIncrease = sizes.slice(at + 1).find((s) => s.monthlyUsd > now.monthlyUsd) ?? null;
  const largest = sizes[sizes.length - 1];

  return {
    parts: filled.length,
    accounts: new Set(providers).size,
    setupSteps: buildChecklist(index, rec.selection).setup.length,
    problems: rec.results.filter((r) => r.level !== "info").length,
    worst: worstLevel(rec.results),
    now: { size: now.size, monthlyUsd: now.monthlyUsd, hasUsage: now.hasUsage, hasUnknown: now.hasUnknown },
    firstIncrease: firstIncrease ? { size: firstIncrease.size, monthlyUsd: firstIncrease.monthlyUsd } : null,
    atLargest: { size: largest.size, monthlyUsd: largest.monthlyUsd, hasUsage: largest.hasUsage, hasUnknown: largest.hasUnknown },
  };
}
