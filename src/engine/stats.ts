import { buildChecklist, setupGroups } from "./checklist";
import { costBySize, costLine, money } from "./cost";
import { needIsOn, optionIn, readFact, worstLevel, type CatalogIndex, type Level } from "./evaluate";
import type { Recommendation } from "./score";
import { SLOT_IDS, type FactValue, type Option, type PlanInput, type SizeId, type SlotId } from "./schema";
import { OWN_PROVIDER } from "./own";
import { extraChecklist } from "./extras";

/**
 * At-a-glance numbers for an option and for a whole plan. Every stat is read from a sourced fact
 * or computed from one, and a fact nobody has researched shows as "Not researched", never as a guess. Stats
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
  const notVerified = (id: string, label: string): Stat => stat(id, label, "Not researched", "Not researched", "unknown");
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
  const choice = (key: string, label: string, words: Record<string, [value: string, short: string, tone: StatTone]>): Stat | null => {
    const fact = known(key);
    const picked = fact && typeof fact.value === "string" ? words[fact.value] : undefined;
    return picked ? stat(key, label, picked[0], picked[1], picked[2], fact!.note, key) : null;
  };

  const now = (): Stat => {
    const label = "Cost at your size";
    if (slot === "payments") {
      const fee = known("fee_summary");
      return fee ? stat("now", "Fee per sale", String(fee.value), String(fee.value), "neutral", fee.note, "fee_summary") : notVerified("now", "Fee per sale");
    }
    const line = costLine(index, option, slot, input);
    if (line.kind === "unknown") return notVerified("now", slot === "domain" ? "First year" : label);
    if (line.kind === "yearly") {
      const price = money(line.yearlyUsd);
      return stat("now", "First year", `${price} for a .com`, `${price} first year`, "neutral", option.facts.com_first_year_usd?.note, "com_first_year_usd");
    }
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

  const renewal = (): Stat | null => {
    const first = known("com_first_year_usd");
    const renews = known("com_renewal_usd");
    if (!renews || typeof renews.value !== "number") return null;
    // A cheap first year that renews much higher is the classic domain surprise.
    const jump = first && typeof first.value === "number" && renews.value > first.value + 3;
    const price = money(renews.value);
    return stat("com_renewal_usd", "Renews at", `${price} a year`, `Renews at ${price}/yr`, jump ? "warn" : "neutral", renews.note, "com_renewal_usd");
  };

  const switching = (): Stat => {
    const label = "Switching later";
    const portability = known("portability");
    const words = portability && SWITCHING[String(portability.value)];
    if (!portability || !words) return notVerified("switching", label);
    return stat("switching", label, words[0], `${words[0]} to switch`, words[1], portability.note, "portability");
  };

  const layout = (): (Stat | null)[] => {
    switch (slot) {
      case "framework":
        return [now(), text("language", "Language"), flag("has_server_code", "Server code", ["Built in", "Has server code", "neutral"], ["Browser only", "Browser only", "neutral"]), switching()];
      case "hosting":
        return [
          now(),
          paidFrom(),
          freePlan(),
          text("runtime_model", "Runs as", RUNS_AS),
          flag("free_plan_sleeps", "Free apps sleep", ["Yes, when idle", "Free apps sleep", "warn"], ["No", "Stays awake", "good"]),
          flag("custom_domain_free", "Own domain on the free plan", ["Included", "Free custom domain", "good"], ["Paid plans only", "Domain needs a paid plan", "warn"]),
          text("bandwidth_included", "Traffic included"),
          switching(),
        ];
      case "domain":
        return [
          now(),
          renewal(),
          flag("whois_privacy_free", "Privacy", ["Included", "Free privacy", "good"], ["Costs extra", "Privacy costs extra", "warn"]),
          flag("dns_included", "DNS", ["Included", "DNS included", "good"], ["Separate", "No DNS included", "warn"]),
          switching(),
        ];
      case "database": {
        const model = text("data_model", "Data", DATA_MODEL);
        const live = known("realtime_built_in")?.value === true;
        return [now(), paidFrom(), freePlan(), model && live ? { ...model, value: `${model.value}, live updates`, short: `${model.short}, live` } : model, switching()];
      }
      case "login":
        return [now(), paidFrom(), freePlan(), flag("prebuilt_ui", "Sign-in screens", ["Ready-made", "Ready-made sign-in", "good"], ["Build your own", "Build your own sign-in", "neutral"]), switching()];
      case "files":
        return [now(), paidFrom(), freePlan(), flag("egress_fees", "Download fees", ["Yes", "Download fees", "warn"], ["None", "No download fees", "good"]), switching()];
      case "payments":
        return [now(), flag("merchant_of_record", "Sales tax", ["Handled for you", "Handles sales tax", "good"], ["Your job", "You handle sales tax", "neutral"]), paidFrom(), switching()];
      case "ai":
        return [now(), text("cheap_model_price", "Cheapest model"), paidFrom(), switching()];
      case "scraping":
        return [
          now(),
          paidFrom(),
          text("scraper_runs", "Runs as", { hosted_api: "Hosted API", hosted_browser: "Hosted browser", your_server: "On your own server" }),
          choice("js_rendering", "Pages built with JavaScript", {
            included: ["Included", "Reads JavaScript pages", "good"],
            costs_extra: ["Costs extra", "JavaScript pages cost extra", "warn"],
            not_supported: ["Not supported", "No JavaScript pages", "warn"],
          }),
          freePlan(),
          flag("ai_ready_output", "Clean text for AI", ["Yes", "AI-ready text", "good"], ["No, raw pages", "Raw pages", "neutral"]),
          text("price_per_1k_pages", "Per 1,000 pages"),
          switching(),
        ];
      case "jobs":
        return [now(), paidFrom(), freePlan(), flag("long_running", "Long-running jobs", ["Supported", "Long jobs OK", "good"], ["Short jobs only", "Short jobs only", "neutral"]), switching()];
      case "email":
        return [now(), paidFrom(), freePlan(), switching()];
      case "automations":
        return [
          now(),
          paidFrom(),
          freePlan(),
          flag("self_hostable", "Run it yourself", ["Yes", "Can self-host", "good"], ["Hosted only", "Hosted only", "neutral"]),
          flag("code_steps", "Your own code", ["Yes", "Runs your code", "good"], ["Built-in steps only", "No code steps", "neutral"]),
          flag("webhook_triggers", "Started by your app", ["Yes", "Webhook start", "good"], ["No", "No webhooks", "warn"]),
          switching(),
        ];
      case "data_apis":
        return [
          now(),
          choice("official_api", "Official API", { official: ["Yes", "Official API", "good"], unofficial: ["No, unofficial", "Unofficial API", "warn"] }),
          flag("needs_api_key", "Needs a key", ["Yes, keep it on the server", "Needs a key", "neutral"], ["No key", "No key", "good"]),
          paidFrom(),
          freePlan(),
          switching(),
        ];
      case "analytics":
        return [
          now(),
          paidFrom(),
          choice("cookies", "Cookies", { none: ["None", "No cookies", "good"], optional: ["Optional", "Can skip cookies", "good"], required: ["Required", "Uses cookies", "warn"] }),
          freePlan(),
          flag("product_events", "Tracks actions", ["Page views and actions", "Tracks actions", "good"], ["Page views only", "Page views only", "neutral"]),
          switching(),
        ];
      case "monitoring":
        return [
          now(),
          paidFrom(),
          freePlan(),
          flag("uptime_checks", "Uptime alerts", ["Yes", "Uptime alerts", "good"], ["No", "No uptime checks", "neutral"]),
          flag("session_replay", "Session replay", ["Yes", "Session replay", "good"], ["No", "No replay", "neutral"]),
          switching(),
        ];
      case "mobile":
        return [
          now(),
          paidFrom(),
          freePlan(),
          flag("needs_mac_for_ios", "iPhone builds", ["Need a Mac", "iPhone needs a Mac", "warn"], ["No Mac needed", "No Mac for iPhone", "good"]),
          text("language", "Language"),
          switching(),
        ];
    }
  };

  return layout().filter((s): s is Stat => s !== null);
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
  /** The companies behind those accounts, by name: one per account, in the order the plan lists its parts. */
  accountNames: string[];
  setupSteps: number;
  problems: number;
  worst: Level | "works";
  now: { size: SizeId; monthlyUsd: number; yearlyUsd: number; oneTimeUsd: number; hasUsage: boolean; hasUnknown: boolean };
  /** The smallest audience size where the plan costs more than it does now. */
  firstIncrease: { size: SizeId; monthlyUsd: number } | null;
  atLargest: PlanStats["now"];
}

const words = (name: string) => name.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
const bare = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The company a person signs up with, from the options StackWise lists for it: the word that names
 * the provider ("Cloudflare", "Firebase", "AWS"), else the one option's name without its aside
 * ("Claude API", "ESPN"), else the words its options start with.
 */
export function companyName(index: CatalogIndex, provider: string): string {
  const names = index.catalog.options.filter((o) => o.provider === provider).map((o) => o.name);
  if (names.length === 0) return provider;
  const named = names.flatMap(words).find((word) => bare(word) === bare(provider));
  if (named) return named;
  if (names.length === 1) return names[0].replace(/\s*\(.*\)\s*$/, "");
  const [first, ...rest] = names.map(words);
  const common = first.filter((word, i) => rest.every((w) => w[i] === word));
  return common.length ? common.join(" ") : names[0];
}

export function planStats(index: CatalogIndex, input: PlanInput, rec: Recommendation): PlanStats {
  const filled = SLOT_IDS.flatMap((slot) => {
    const option = optionIn(index, rec.selection, slot);
    return option ? [{ slot, option }] : [];
  });
  const providers = filled
    .filter(({ slot, option }) => slot !== "framework" && option.provider !== OWN_PROVIDER && !index.catalog.planning.no_account_providers.includes(option.provider))
    .map(({ option }) => option.provider);
  // Extras need accounts too; one from a company already in the plan shares its account.
  for (const extra of Object.values(input.extras ?? {})) {
    const option = index.optionsById.get(extra.option);
    if (option && option.provider !== OWN_PROVIDER && !index.catalog.planning.no_account_providers.includes(option.provider)) providers.push(option.provider);
  }
  const accountProviders = [...new Set(providers)];

  const sizes = costBySize(index, rec.selection, input);
  const at = sizes.findIndex((s) => s.size === input.size);
  const now = sizes[at];
  const firstIncrease = sizes.slice(at + 1).find((s) => s.monthlyUsd > now.monthlyUsd) ?? null;
  const largest = sizes[sizes.length - 1];

  return {
    parts: filled.length,
    accounts: accountProviders.length,
    accountNames: accountProviders.map((provider) => companyName(index, provider)),
    setupSteps: setupGroups(index, buildChecklist(index, rec.selection)).reduce((n, group) => n + group.items.length, 0) + extraChecklist(index, rec.selection, input.extras).setup.length,
    problems: rec.results.filter((r) => r.level !== "info").length,
    worst: worstLevel(rec.results),
    now: { size: now.size, monthlyUsd: now.monthlyUsd, yearlyUsd: now.yearlyUsd, oneTimeUsd: now.oneTimeUsd, hasUsage: now.hasUsage, hasUnknown: now.hasUnknown },
    firstIncrease: firstIncrease ? { size: firstIncrease.size, monthlyUsd: firstIncrease.monthlyUsd } : null,
    atLargest: { size: largest.size, monthlyUsd: largest.monthlyUsd, yearlyUsd: largest.yearlyUsd, oneTimeUsd: largest.oneTimeUsd, hasUsage: largest.hasUsage, hasUnknown: largest.hasUnknown },
  };
}
