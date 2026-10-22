import { describe, expect, it } from "vitest";
import { buildPlan } from "./buildplan";
import { ownId } from "./own";
import type { Selection } from "./schema";
import { fixtureIndex, input } from "./test-fixtures";
import { testPlan, testPlanText } from "./testplan";

const index = fixtureIndex();
const stack: Selection = { framework: "fw-server", hosting: "host-server", database: "db-hosted", login: ownId("login"), payments: "pay-card" };
const plan = input({ saves_data: "yes", login: "yes", users_pay: "yes" });
const layout = { notes: {}, custom: { "custom-search": { name: "Meilisearch", role: "searches with", url: "", env: [], note: "" } }, links: { "payments>app": { from: "payments", to: "app", kind: "webhook" as const } } };
const tasks = buildPlan(index, plan, stack, layout);
const task = (id: string) => tasks.find((t) => t.id === id)!;

describe("test plans", () => {
  it("tells a payments task to replay a webhook in test mode and never charge a card, and names the service", () => {
    const tp = testPlan(index, plan, stack, task("part:payments"), "Fade");
    expect(tp.checks.join(" ")).toContain("webhook");
    expect(tp.fakes[0]).toContain("pay-card's test mode keys");
    expect(tp.limits).toContain("Tests never call the real service, never send real mail or money, and never spend AI credit.");
  });

  it("keeps the service out of a database task and lists the limits StackWise knows about it", () => {
    const tp = testPlan(index, plan, stack, task("part:database"));
    expect(tp.fakes[0]).toContain("throwaway database");
    expect(tp.known.length).toBeGreaterThan(0);
    expect(tp.known[0]).toMatch(/: /);
  });

  it("treats a part built by hand as your own code behind an adapter, with nothing known about it", () => {
    const tp = testPlan(index, plan, stack, task("part:login"));
    expect(tp.checks[0]).toContain("Your own code");
    expect(tp.known).toEqual([]);
  });

  it("gives lines, parts StackWise doesn't list and the setup their own plans", () => {
    expect(testPlan(index, plan, stack, task("link:payments>app")).limits[0]).toContain("One integration test per line");
    expect(testPlan(index, plan, stack, task("custom:custom-search")).fakes[0]).toContain("Meilisearch");
    expect(testPlan(index, plan, stack, task("setup")).checks[0]).toContain(".env.example");
  });

  it("writes the plan as text without an em dash", () => {
    const text = testPlanText(testPlan(index, plan, stack, task("part:payments"))).join("\n");
    expect(text).toContain("Check:\n- ");
    expect(text).toContain("Keep the service out:");
    expect(text).not.toContain("—");
  });
});
