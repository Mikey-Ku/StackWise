import { describe, expect, it } from "vitest";
import { costSummary } from "./cost";
import { extraChecklist, extraResults, linkVerdict } from "./extras";
import { mergePlans } from "./merge";
import { applyPlanUpdate, planDigest, planInput, PlanUpdateError } from "./planops";
import type { PlanInput, Selection } from "./schema";
import { recommend } from "./score";
import { sharedPlanSchema, type SharedPlan } from "./share";
import { planStats } from "./stats";
import { fixtureIndex, input } from "./test-fixtures";
import { connectionsOf, planEnv } from "./wiring";

const index = fixtureIndex();
const stack: Selection = { framework: "fw-server", hosting: "host-serverless", database: "db-hosted", login: "login-acme" };
const withCache = (option: string): PlanInput => ({ ...input({ saves_data: "yes", login: "yes" }), extras: { "database.cache": { slot: "database", option, role: "cache" } } });

describe("extra services in a part", () => {
  it("checks an extra as if it filled the part, and says which extra each result is about", () => {
    const results = extraResults(index, stack, withCache("db-file"));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.instance === "database.cache" && r.slots.includes("database"))).toBe(true);
    // A local file on serverless hosting is blocked, for the cache exactly as for a main database.
    expect(results.some((r) => r.level === "blocked" && r.slots.includes("hosting"))).toBe(true);
    // The part's first service is untouched.
    const rec = recommend(index, withCache("db-file"), stack);
    expect(rec.selection.database).toBe("db-hosted");
    expect(rec.results.filter((r) => !r.instance).some((r) => r.level === "blocked")).toBe(false);
  });

  it("prices an extra, counts its account, and marks a second copy of the same service as depending on its limits", () => {
    const other = costSummary(index, stack, withCache("db-file"));
    expect(other.lines.find((l) => l.instance === "database.cache")).toMatchObject({ kind: "free" });
    const twin = costSummary(index, stack, withCache("db-hosted"));
    expect(twin.lines.find((l) => l.instance === "database.cache")).toMatchObject({ kind: "unknown", headline: "A second one: check its plan's limits" });
    const plain = planStats(index, withCache("db-hosted"), recommend(index, { ...withCache("db-hosted"), extras: undefined }, stack));
    const extra = planStats(index, withCache("db-file"), recommend(index, withCache("db-file"), stack));
    expect(extra.accounts).toBe(plain.accounts);
  });

  it("names a clashing variable after the extra's role, and gives the extra its own line and steps", () => {
    const vars = planEnv(index, stack, withCache("db-hosted").extras);
    expect(vars.map((v) => v.name)).toEqual(expect.arrayContaining(["DB_HOSTED_KEY", "CACHE_DB_HOSTED_KEY"]));
    const line = connectionsOf(index, stack, withCache("db-hosted").extras).find((c) => c.instance === "database.cache");
    expect(line).toMatchObject({ slot: "database", label: "cache", env: [expect.objectContaining({ name: "CACHE_DB_HOSTED_KEY" })] });
    const steps = extraChecklist(index, stack, withCache("db-hosted").extras);
    expect(steps.setup).toEqual([expect.objectContaining({ id: "setup:database.cache:0", env: ["CACHE_DB_HOSTED_KEY"] })]);
  });
});

describe("lines between parts", () => {
  const plan = (extra: Partial<SharedPlan> = {}): SharedPlan =>
    sharedPlanSchema.parse({ v: 1, appName: "Fade", description: "", features: "", answers: { saves_data: "yes", login: "yes" }, size: "up_to_100", priority: "spend_zero", builderId: "claude-code", pinned: stack, notes: {}, ...extra });

  it("is not checked when no rule reads the two parts, and takes the rules' verdict when one does", () => {
    const p = plan();
    const rec = recommend(index, planInput(p), p.pinned);
    expect(linkVerdict(index, rec.results, { from: "payments", to: "app", kind: "webhook" }, rec.selection, planInput(p))).toMatchObject({ checked: false, level: "unknown" });
    const serverless = linkVerdict(index, rec.results, { from: "hosting", to: "database", kind: "calls" }, rec.selection, planInput(p));
    expect(serverless.checked).toBe(true);
  });

  it("adds extras and lines through update_plan, refuses ends that aren't there, and shows them in the digest", () => {
    const { plan: next, changes } = applyPlanUpdate(index, plan(), {
      extras: { "database.cache": { option: "db-file", role: "cache" } },
      links: [
        { from: "login", to: "database", kind: "writes", what: "user rows" },
        { from: "database.cache", to: "app", kind: "calls" },
      ],
    });
    expect(changes).toEqual(expect.arrayContaining(["Added db-file to Database as cache", "login-acme writes to db-hosted: user rows"]));
    expect(Object.keys(next.links ?? {})).toEqual(["login>database", "database.cache>app"]);
    const digest = planDigest(index, next);
    expect(digest).toContain("  - database.cache: db-file [blocked] you, for cache");
    expect(digest).toContain("- login -> database (writes to: user rows)");
    expect(() => applyPlanUpdate(index, plan(), { links: [{ from: "jobs", to: "database", kind: "reads" }] })).toThrow(PlanUpdateError);
    expect(() => applyPlanUpdate(index, plan(), { extras: { "framework.second": { option: "fw-browser" } } })).toThrow("one framework");
    // Removing an extra takes its lines with it.
    const removed = applyPlanUpdate(index, next, { extras: { "database.cache": null } }).plan;
    expect(Object.keys(removed.links ?? {})).toEqual(["login>database"]);
  });

  it("merges extras and lines key by key between the browser and an agent", () => {
    const base = plan();
    const ours = plan({ extras: { "database.cache": { slot: "database", option: "db-file", role: "cache" } } });
    const theirs = plan({ links: { "login>database": { from: "login", to: "database", kind: "writes" } } });
    const { plan: merged, conflicts } = mergePlans(base, ours, theirs, true);
    expect(conflicts).toEqual([]);
    expect(Object.keys(merged.extras ?? {})).toEqual(["database.cache"]);
    expect(Object.keys(merged.links ?? {})).toEqual(["login>database"]);
  });
});
