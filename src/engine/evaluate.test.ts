import { describe, expect, it } from "vitest";
import { evaluatePlan, worstLevel } from "./evaluate";
import { fixtureIndex, fixtureProductRules, input } from "./test-fixtures";

const index = fixtureIndex();
const find = (results: ReturnType<typeof evaluatePlan>, ruleId: string) => results.find((r) => r.ruleId === ruleId);

describe("capability rules", () => {
  it("blocks a file database on a host with no permanent disk", () => {
    const results = evaluatePlan(index, { hosting: "host-serverless", database: "db-file" }, input());
    const result = find(results, "file-database-needs-disk");
    expect(result?.level).toBe("blocked");
    expect(result?.slots).toEqual(["hosting", "database"]);
    expect(result?.title).toBe("Your data would disappear");
    expect(result?.explanation).toContain("host-serverless");
  });

  it("warns instead of blocking when the disk is a paid add-on", () => {
    const results = evaluatePlan(index, { hosting: "host-server", database: "db-file" }, input());
    expect(find(results, "file-database-needs-disk")).toBeUndefined();
    expect(find(results, "file-database-paid-disk")?.level).toBe("warning");
  });

  it("stays quiet when a condition is false", () => {
    const results = evaluatePlan(index, { hosting: "host-serverless", database: "db-hosted" }, input());
    expect(find(results, "file-database-needs-disk")).toBeUndefined();
    expect(worstLevel(results)).toBe("works");
  });

  it("never treats a missing fact as works", () => {
    const results = evaluatePlan(index, { hosting: "host-partial", database: "db-file" }, input());
    const result = find(results, "file-database-needs-disk");
    expect(result?.level).toBe("unknown");
    expect(result?.missingFacts).toEqual([{ optionId: "host-partial", fact: "persistent_disk" }]);
    expect(worstLevel(results)).not.toBe("works");
  });

  it("clears a rule with an unknown fact when another condition is definitely false", () => {
    const results = evaluatePlan(index, { hosting: "host-partial", database: "db-hosted" }, input());
    expect(find(results, "file-database-needs-disk")).toBeUndefined();
    expect(results.some((r) => r.source === "coverage" && r.level === "unknown")).toBe(true);
  });

  it("only runs need-based rules on a confirmed yes", () => {
    const plan = { hosting: "host-serverless", database: "db-file" };
    expect(find(evaluatePlan(index, plan, input({ live_updates: "yes" })), "live-updates-nowhere")?.level).toBe("warning");
    expect(find(evaluatePlan(index, plan, input({ live_updates: "not_sure" })), "live-updates-nowhere")).toBeUndefined();
    expect(find(evaluatePlan(index, plan, input({ live_updates: "no" })), "live-updates-nowhere")).toBeUndefined();
  });

  it("respects only_if: big uploads don't count unless uploads is yes", () => {
    const plan = { files: "files-direct" };
    expect(find(evaluatePlan(index, plan, input({ large_uploads: "yes" })), "large-uploads-go-direct")).toBeUndefined();
    expect(find(evaluatePlan(index, plan, input({ uploads: "yes", large_uploads: "yes" })), "large-uploads-go-direct")?.level).toBe("info");
  });

  it("looks framework support up by the framework in the plan", () => {
    const partial = evaluatePlan(index, { framework: "fw-browser", hosting: "host-server" }, input());
    expect(find(partial, "framework-partial-support")?.title).toBe("fw-browser needs extra setup on host-server");

    const unknown = evaluatePlan(index, { framework: "fw-server", hosting: "host-partial" }, input());
    const result = unknown.find((r) => r.level === "unknown" && r.slots.includes("framework"));
    expect(result?.missingFacts?.[0]).toEqual({ optionId: "host-partial", fact: "framework_support" });
    // Two rules wait on the same missing fact; the person sees it once.
    expect(unknown.filter((r) => r.level === "unknown" && r.slots.includes("framework"))).toHaveLength(1);
  });

  it("warns that a browser-only app can't hold payment keys", () => {
    const results = evaluatePlan(index, { framework: "fw-browser" }, input({ users_pay: "yes" }));
    expect(find(results, "browser-only-app-with-payments")?.level).toBe("warning");
  });

  it("warns about a non-commercial free plan only when the app takes payments", () => {
    const plan = { hosting: "host-serverless" };
    expect(find(evaluatePlan(index, plan, input({ users_pay: "yes" })), "free-plan-not-commercial")?.level).toBe("warning");
    expect(find(evaluatePlan(index, plan, input()), "free-plan-not-commercial")).toBeUndefined();
  });
});

describe("product rules", () => {
  it("adds perks for an exact pair", () => {
    const results = evaluatePlan(index, { login: "login-acme", database: "db-hosted" }, input());
    expect(find(results, "fixture-acme-perk")?.level).toBe("info");
  });

  it("cannot loosen a capability verdict", () => {
    const loosening = fixtureIndex({
      productRules: [
        ...fixtureProductRules,
        {
          id: "tries-to-bless-file-db",
          severity: "info",
          needs: [],
          pair: [
            { slot: "hosting", option: "host-serverless" },
            { slot: "database", option: "db-file" },
          ],
          title: "Great together",
          explanation: "A product rule that would like this to work.",
        },
      ],
    });
    const results = evaluatePlan(loosening, { hosting: "host-serverless", database: "db-file" }, input());
    expect(find(results, "tries-to-bless-file-db")?.level).toBe("info");
    expect(find(results, "file-database-needs-disk")?.level).toBe("blocked");
    expect(worstLevel(results)).toBe("blocked");
  });
});

describe("missing pieces", () => {
  it("flags a needed slot that is empty, once per slot", () => {
    const results = evaluatePlan(index, { framework: "fw-server", hosting: "host-server" }, input({ login: "yes", saves_data: "yes" }));
    const missing = results.filter((r) => r.level === "missing");
    expect(missing.map((r) => r.slots[0]).sort()).toEqual(["database", "login"]);
    expect(missing.find((r) => r.slots[0] === "database")?.explanation).toContain("saves what people create");
  });
});
