import path from "node:path";
import { indexCatalog, type CatalogIndex } from "./evaluate";
import { loadCatalog } from "./load";
import type { Catalog, Fact, FactValue, Option, PlanInput, ProductRule, SlotId } from "./schema";

/**
 * Engine tests run the real rules, questions and weights from /data against made-up options with
 * known facts. That way a test fails because the logic changed, not because a provider changed
 * its pricing page.
 */

const realCatalog = loadCatalog(path.join(__dirname, "..", "..", "data"));

function fact(value: FactValue): Fact {
  return { value, note: "fixture", source: "https://example.com/fixture", retrieved: "2026-09-15", status: "draft" };
}

function option(id: string, provider: string, slots: SlotId[], facts: Record<string, FactValue>, extra: Partial<Option> = {}): Option {
  return {
    id,
    name: id,
    provider,
    slots,
    summary: `${id} fixture`,
    website: "https://example.com",
    coverage: "full",
    facts: Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, fact(v)])),
    setup: [{ step: `Set up ${id}.`, env: [`${id.toUpperCase().replace(/-/g, "_")}_KEY`], source: "https://example.com/setup" }],
    builder_notes: [`Use ${id} carefully.`],
    ...extra,
  };
}

const base = (covers: string, price: number | null, portability = "high") => ({
  free_plan_covers: covers,
  first_paid_usd_month: price,
  portability,
});

export const fixtureOptions: Option[] = [
  option("fw-server", "open-source", ["framework"], { ...base("more", null), language: "TypeScript", has_server_code: true, uses_react: true }),
  option("fw-browser", "open-source", ["framework"], { ...base("more", null), language: "TypeScript", has_server_code: false, uses_react: true }),
  option("host-serverless", "cloudco", ["hosting"], {
    ...base("up_to_1000", 20, "medium"),
    runtime_model: "serverless",
    persistent_disk: "none",
    long_lived_connections: false,
    background_workers: false,
    scheduled_jobs: false,
    free_plan_commercial_use: false,
    framework_support: { "fw-server": "full", "fw-browser": "full" },
    custom_domain_free: true,
    free_plan_sleeps: false,
    bandwidth_included: "100 GB a month",
  }),
  option("host-server", "boxco", ["hosting"], {
    ...base("just_me", 7, "high"),
    runtime_model: "server",
    persistent_disk: "paid_addon",
    long_lived_connections: true,
    background_workers: true,
    scheduled_jobs: true,
    free_plan_commercial_use: true,
    framework_support: { "fw-server": "full", "fw-browser": "partial" },
    custom_domain_free: false,
    free_plan_sleeps: true,
    bandwidth_included: "100 GB a month",
  }),
  option("host-partial", "mystery", ["hosting"], {}, { coverage: "partial", setup: [], builder_notes: [] }),
  option("db-file", "open-source", ["database"], {
    ...base("more", null),
    storage_model: "local_file",
    data_model: "relational",
    realtime_built_in: false,
    serverless_friendly: false,
    mobile_sdk: false,
  }),
  option("db-hosted", "acme", ["database"], {
    ...base("up_to_1000", 25),
    storage_model: "hosted",
    data_model: "relational",
    realtime_built_in: true,
    serverless_friendly: true,
    mobile_sdk: true,
  }),
  option("login-acme", "acme", ["login"], { ...base("more", 25), mobile_sdk: true, prebuilt_ui: true, builtin_email_production_ready: true }),
  option("login-solo", "soloauth", ["login"], { ...base("more", 25), mobile_sdk: true, prebuilt_ui: true, builtin_email_production_ready: true }),
  option("login-cheap", "cheapauth", ["login"], { ...base("more", 20), mobile_sdk: true, prebuilt_ui: true, builtin_email_production_ready: true }),
  option("login-lib", "open-source", ["login"], { ...base("more", null), mobile_sdk: false, prebuilt_ui: false, builtin_email_production_ready: false }),
  option("jobs-durable", "jobco", ["jobs"], { ...base("up_to_1000", 20), sdk_typescript: true, long_running: true, schedules: true }),
  option("jobs-caller", "callco", ["jobs"], { ...base("up_to_1000", 10), sdk_typescript: true, long_running: false, schedules: false }),
  option("email-send", "mailco", ["email"], { ...base("up_to_1000", 20), sdk_typescript: true }),
  option("mobile-react", "mobileco", ["mobile"], { ...base("up_to_1000", 19), language: "TypeScript", shares_react_skills: true, needs_mac_for_ios: false }),
  option("mobile-other", "open-source", ["mobile"], { ...base("more", null), language: "Dart", shares_react_skills: false, needs_mac_for_ios: true }),
  option("files-direct", "acme", ["files"], { ...base("up_to_1000", 25), direct_uploads: true, egress_fees: true }),
  option("pay-card", "payco", ["payments"], {
    ...base("more", null),
    merchant_of_record: false,
    subscriptions: true,
    fee_summary: "2.9% + 30c",
    card_fee_percent: 2.9,
    card_fee_fixed_usd: 0.3,
  }),
  option("pay-merchant", "sellerco", ["payments"], {
    ...base("more", null, "low"),
    merchant_of_record: true,
    subscriptions: true,
    fee_summary: "5% + 50c",
    card_fee_percent: 5,
    card_fee_fixed_usd: 0.5,
  }),
  option("ai-paid", "brainco", ["ai"], { ...base("none", null), free_tier: false, sdk_typescript: true, cheap_model_price: "$1 in / $2 out" }),
  option("domain-cheap", "boxco", ["domain"], { ...base("none", null), com_first_year_usd: 10, com_renewal_usd: 10, whois_privacy_free: true, dns_included: true }),
  option("domain-promo", "promoreg", ["domain"], { ...base("none", null), com_first_year_usd: 5, com_renewal_usd: 20, whois_privacy_free: false, dns_included: true }),
  option("scrape-api", "scrapeco", ["scraping"], {
    ...base("just_me", 16, "medium"),
    scraper_runs: "hosted_api",
    js_rendering: "costs_extra",
    ai_ready_output: true,
    price_per_1k_pages: "About $5 per 1,000 pages",
  }),
  option("scrape-lib", "open-source", ["scraping"], {
    ...base("more", null),
    scraper_runs: "your_server",
    js_rendering: "included",
    ai_ready_output: false,
    price_per_1k_pages: "Free software; you pay for the server",
  }),
];

export const fixtureProductRules: ProductRule[] = [
  {
    id: "fixture-acme-perk",
    severity: "info",
    needs: [],
    pair: [
      { slot: "login", option: "login-acme" },
      { slot: "database", option: "db-hosted" },
    ],
    title: "Acme login and data share a project",
    explanation: "Fixture perk.",
    builder: "Use Acme row rules.",
  },
];

export function fixtureCatalog(overrides: Partial<Catalog> = {}): Catalog {
  // Starting picks name real options, so fixture plans pick by score alone unless a test sets one.
  return { ...realCatalog, planning: { ...realCatalog.planning, starting_picks: {} }, options: fixtureOptions, productRules: fixtureProductRules, ...overrides };
}

export function fixtureIndex(overrides: Partial<Catalog> = {}): CatalogIndex {
  return indexCatalog(fixtureCatalog(overrides));
}

export function input(answers: PlanInput["answers"] = {}, extra: Partial<PlanInput> = {}): PlanInput {
  return { answers, size: "up_to_100", priority: "spend_zero", ...extra };
}
