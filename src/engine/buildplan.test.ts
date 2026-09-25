import { describe, expect, it } from "vitest";
import { buildPlan, buildPlanDigest, buildPlanMarkdown, taskBrief } from "./buildplan";
import { ownId } from "./own";
import type { PlanInput, Selection } from "./schema";
import type { SharedPlan } from "./share";
import { fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();
const stack: Selection = { framework: "fw-server", hosting: "host-server", database: "db-hosted", login: "login-acme" };
const plain: PlanInput = input({ saves_data: "yes", login: "yes" });
const withCache: PlanInput = { ...plain, extras: { "database.cache": { slot: "database", option: "db-file", role: "cache", note: "Sessions only." } } };
const note = (text: string) => ({ text, updatedAt: "2026-09-24T00:00:00.000Z", by: "you" as const });

const layout = (extra: Partial<SharedPlan> = {}) => ({ notes: {}, custom: {}, links: {}, ...extra });

describe("build plan", () => {
  it("starts with accounts, builds the app first and ships it last, each extra right after its part", () => {
    const tasks = buildPlan(index, withCache, stack, layout());
    const ids = tasks.map((t) => t.id);
    expect(ids[0]).toBe("setup");
    expect(ids[1]).toBe("part:framework");
    expect(ids.at(-1)).toBe("part:hosting");
    expect(ids.indexOf("extra:database.cache")).toBe(ids.indexOf("part:database") + 1);
    expect(tasks.find((t) => t.id === "extra:database.cache")).toMatchObject({ after: ["part:database"], note: "Sessions only.", agent: "build-database", slot: "database" });
    // Hosting ships everything, so it waits for every other part.
    expect(tasks.find((t) => t.id === "part:hosting")!.after).toEqual(expect.arrayContaining(["part:framework", "part:database", "extra:database.cache", "part:login"]));
  });

  it("keeps the person's note word for word on one line, and names the variables the part reads", () => {
    const tasks = buildPlan(index, plain, stack, layout({ notes: { database: note("Tables: users,\n  bookings.") } }));
    expect(tasks.find((t) => t.id === "part:database")).toMatchObject({ note: "Tables: users, bookings.", env: ["DB_HOSTED_KEY"] });
  });

  it("puts each line right after the later of its two ends, and says when no rule checks it", () => {
    const tasks = buildPlan(index, plain, stack, layout({ links: { "login>database": { from: "login", to: "database", kind: "writes", what: "user rows" } } }));
    const ids = tasks.map((t) => t.id);
    expect(ids.indexOf("link:login>database")).toBe(ids.indexOf("part:login") + 1);
    const line = tasks.find((t) => t.kind === "link")!;
    // A rule reads login and database together and found nothing, so there's nothing to watch.
    expect(line).toMatchObject({ task: expect.stringContaining("write user rows to"), after: ["part:login", "part:database"], agent: "build-login", watch: [] });
    const paid = buildPlan(index, input({ saves_data: "yes", login: "yes", users_pay: "yes" }), { ...stack, payments: "pay-card" }, layout({ links: { "payments>app": { from: "payments", to: "app", kind: "webhook" } } }));
    expect(paid.find((t) => t.kind === "link")).toMatchObject({ title: expect.stringContaining("sends webhooks to the app"), agent: "build-payments", watch: [expect.stringMatching(/^Not checked/)] });
  });

  it("builds a part by hand and a part StackWise doesn't list, before hosting, and checks neither", () => {
    const custom = { "custom-search": { name: "Meilisearch", role: "searches listings with", url: "https://example.com/meili", env: ["MEILI_KEY"], note: "" } };
    const tasks = buildPlan(index, plain, { ...stack, login: ownId("login") }, layout({ custom }));
    expect(tasks.find((t) => t.id === "part:login")).toMatchObject({ kind: "own", title: "Login: your own", watch: [], env: [] });
    const search = tasks.find((t) => t.id === "custom:custom-search")!;
    expect(search).toMatchObject({ env: ["MEILI_KEY"], after: ["part:framework"], task: expect.stringContaining("the app searches listings with it") });
    expect(tasks.findIndex((t) => t.id === "custom:custom-search")).toBeLessThan(tasks.findIndex((t) => t.id === "part:hosting"));
  });

  it("carries the rules' problems on the part they touch", () => {
    const tasks = buildPlan(index, withCache, { ...stack, hosting: "host-serverless" }, layout());
    // A local file on serverless hosting is blocked, for the cache exactly as for a main database.
    expect(tasks.find((t) => t.id === "extra:database.cache")!.watch.some((w) => w.startsWith("Blocked"))).toBe(true);
  });

  it("writes TASKS.md, a digest and one task as a message, without an em dash", () => {
    const tasks = buildPlan(index, withCache, stack, layout({ notes: { login: note("Google only.") }, links: { "login>database": { from: "login", to: "database", kind: "writes" } } }));
    const md = buildPlanMarkdown(tasks, { appName: "Fade", generatedOn: "2026-09-24", problems: true });
    expect(md).toContain("# Tasks for Fade");
    expect(md).toContain("## 1. Framework:");
    expect(md).toContain("The person's note: Google only.");
    expect(md).toContain("After: Database:");
    expect(md).toContain("Agent: `stack-guard`");
    expect(buildPlanDigest(tasks).split("\n")).toHaveLength(tasks.length);
    const brief = taskBrief(tasks, "part:login", "Fade")!;
    expect(brief).toContain("StackWise task part:login");
    expect(brief).toContain("The person's note on it: Google only.");
    expect(brief).toContain("Done when:");
    expect(taskBrief(tasks, "part:nope")).toBeNull();
    expect(`${md}${brief}`).not.toContain("—");
  });
});
