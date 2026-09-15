import { describe, expect, it } from "vitest";
import { recommend } from "./score";
import { cardStats, money, optionStats, planStats } from "./stats";
import { fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();
const opt = (id: string) => index.optionsById.get(id)!;
const byId = (stats: ReturnType<typeof optionStats>) => Object.fromEntries(stats.map((s) => [s.id, s]));

describe("option stats", () => {
  it("leads with cost, then the paid plan, the free plan, a key trait and switching cost", () => {
    const stats = optionStats(index, opt("host-server"), "hosting", input({}, { size: "up_to_1000" }));
    expect(stats.map((s) => s.id)).toEqual(["now", "paidFrom", "freePlan", "runtime_model", "switching"]);
    const s = byId(stats);
    expect(s.now).toMatchObject({ value: "$7/mo", short: "$7/mo now", tone: "warn" });
    expect(s.paidFrom).toMatchObject({ value: "$7/mo", short: "Paid from $7/mo" });
    expect(s.freePlan).toMatchObject({ value: "Just you", short: "Free for just you", tone: "neutral" });
    expect(s.runtime_model).toMatchObject({ label: "Runs as", value: "Always-on server" });
    expect(s.switching).toMatchObject({ value: "Easy", short: "Easy to switch", tone: "good" });
    expect(s.now.note).toBe("The free plan covers just you. fixture");
    expect(stats.map((x) => x.fact)).toEqual([undefined, "first_paid_usd_month", "free_plan_covers", "runtime_model", "portability"]);
  });

  it("marks a free fit as good, and warns when a free plan doesn't allow charging customers", () => {
    const free = byId(optionStats(index, opt("host-serverless"), "hosting", input()));
    expect(free.now).toMatchObject({ value: "Free", tone: "good" });
    expect(free.freePlan).toMatchObject({ value: "Up to 1,000 people, not for apps that charge", tone: "good" });

    expect(free.freePlan.short).toBe("Free up to 1,000 people, personal use");

    const charging = byId(optionStats(index, opt("host-serverless"), "hosting", input({ users_pay: "yes" })));
    expect(charging.now).toMatchObject({ value: "$20/mo", tone: "warn" });
    expect(charging.freePlan).toMatchObject({ short: "Free plan not for paid apps", tone: "warn" });
  });

  it("never guesses for an unresearched option", () => {
    const stats = optionStats(index, opt("host-partial"), "hosting", input());
    expect(stats.map((s) => s.id)).toEqual(["now", "paidFrom", "freePlan", "switching"]);
    expect(stats.every((s) => s.value === "Not verified" && s.tone === "unknown")).toBe(true);
    expect(cardStats(stats)).toEqual([]);
  });

  it("shows what matters for each kind of part", () => {
    const payments = byId(optionStats(index, opt("pay-card"), "payments", input()));
    expect(payments.now).toMatchObject({ label: "Fee per sale", value: "2.9% + 30c" });
    expect(payments.merchant_of_record).toMatchObject({ value: "Your job", short: "You handle sales tax" });
    expect(payments.paidFrom.value).toBe("No monthly plan");
    expect(payments.freePlan).toBeUndefined();

    const ai = byId(optionStats(index, opt("ai-paid"), "ai", input()));
    expect(ai.now).toMatchObject({ value: "Pay per use", tone: "neutral" });
    expect(ai.cheap_model_price.value).toBe("$1 in / $2 out");
    expect(ai.freePlan).toBeUndefined();

    const framework = optionStats(index, opt("fw-browser"), "framework", input());
    expect(framework.map((s) => `${s.label}: ${s.value}`)).toEqual(["Cost at your size: Free", "Language: TypeScript", "Server code: Browser only", "Switching later: Easy"]);

    expect(byId(optionStats(index, opt("db-hosted"), "database", input())).data_model.value).toBe("Tables (SQL), live updates");
    expect(byId(optionStats(index, opt("files-direct"), "files", input())).egress_fees).toMatchObject({ short: "Download fees", tone: "warn" });
    expect(byId(optionStats(index, opt("mobile-other"), "mobile", input())).needs_mac_for_ios).toMatchObject({ value: "Need a Mac", tone: "warn" });
  });

  it("puts the first known stats on cards, skipping a paid plan the cost already implies", () => {
    const shorts = (id: string, slot: Parameters<typeof optionStats>[2], plan = input()) => cardStats(optionStats(index, opt(id), slot, plan)).map((s) => s.short);
    expect(shorts("login-lib", "login")).toEqual(["Free now", "No monthly plan", "Free past 1,000 people"]);
    expect(shorts("host-server", "hosting", input({}, { size: "up_to_1000" }))).toEqual(["$7/mo now", "Free for just you", "Always-on server"]);
    expect(shorts("ai-paid", "ai")).toEqual(["Pay per use", "$1 in / $2 out", "Easy to switch"]);
  });

  it("formats prices with cents only when there are cents", () => {
    expect([money(20), money(19.95), money(4.9)]).toEqual(["$20", "$19.95", "$4.90"]);
  });
});

describe("plan stats", () => {
  it("counts parts, accounts, setup steps and problems, and finds where cost first rises", () => {
    const plan = input({ saves_data: "yes", login: "yes" }, { size: "just_me", priority: "spend_zero" });
    const rec = recommend(index, plan, { framework: "fw-server", hosting: "host-server", database: "db-hosted", login: "login-acme" });
    const stats = planStats(index, plan, rec);
    expect(stats).toMatchObject({ parts: 4, accounts: 2, setupSteps: 4, problems: 0, worst: "works" });
    expect(stats.now).toMatchObject({ size: "just_me", monthlyUsd: 0 });
    expect(stats.firstIncrease).toEqual({ size: "up_to_100", monthlyUsd: 7 });
    expect(stats.atLargest).toMatchObject({ size: "more", monthlyUsd: 32 });
  });

  it("has no increase to show at the largest size", () => {
    const plan = input({ login: "yes" }, { size: "more" });
    const stats = planStats(index, plan, recommend(index, plan, {}));
    expect(stats.firstIncrease).toBeNull();
    expect(stats.atLargest).toEqual(stats.now);
  });
});
