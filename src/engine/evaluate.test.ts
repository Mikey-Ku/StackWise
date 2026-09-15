import { describe, expect, it } from "vitest";
import { fillTemplate, evaluatePlan, worstLevel } from "./evaluate";
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

describe("rules that check whether a slot is filled", () => {
  it("drops the long-jobs warning once a jobs service is in the plan", () => {
    const answers = { long_jobs: "yes" } as const;
    expect(find(evaluatePlan(index, { hosting: "host-serverless" }, input(answers)), "long-jobs-need-workers")?.level).toBe("warning");
    const withJobs = evaluatePlan(index, { hosting: "host-serverless", jobs: "jobs-durable" }, input(answers));
    expect(find(withJobs, "long-jobs-need-workers")).toBeUndefined();
    expect(find(withJobs, "long-jobs-in-service")?.level).toBe("info");
  });

  it("still warns when the jobs service only calls back into the app", () => {
    const results = evaluatePlan(index, { hosting: "host-serverless", jobs: "jobs-caller" }, input({ long_jobs: "yes", scheduled_tasks: "yes" }));
    expect(find(results, "long-jobs-service-too-short")?.level).toBe("warning");
    expect(find(results, "schedule-service-without-cron")?.level).toBe("warning");
    expect(find(results, "schedule-needs-cron")).toBeUndefined();
  });

  it("asks for an email service when login can't send its own emails", () => {
    const plan = { login: "login-lib" };
    expect(find(evaluatePlan(index, plan, input({ login: "yes" })), "login-emails-need-a-sender")?.level).toBe("warning");
    const withEmail = evaluatePlan(index, { ...plan, email: "email-send" }, input({ login: "yes" }));
    expect(find(withEmail, "login-emails-need-a-sender")).toBeUndefined();
    expect(find(withEmail, "login-emails-through-service")?.builder).toContain("email-send");
    expect(find(evaluatePlan(index, { login: "login-acme" }, input({ login: "yes" })), "login-emails-need-a-sender")).toBeUndefined();
  });

  it("asks for a domain once the app sends email", () => {
    const sends = input({ sends_email: "yes" });
    expect(find(evaluatePlan(index, { email: "email-send" }, sends), "email-needs-own-domain")?.level).toBe("warning");
    expect(find(evaluatePlan(index, { email: "email-send", domain: "domain-cheap" }, sends), "email-needs-own-domain")).toBeUndefined();
    expect(find(evaluatePlan(index, { email: "email-send" }, input()), "email-needs-own-domain")).toBeUndefined();
  });

  it("keeps a self-run scraper out of serverless functions", () => {
    const serverless = evaluatePlan(index, { hosting: "host-serverless", scraping: "scrape-lib" }, input());
    expect(find(serverless, "self-run-scraper-on-serverless")?.level).toBe("warning");
    expect(find(evaluatePlan(index, { hosting: "host-server", domain: "domain-cheap" }, input()), "own-domain-needs-paid-host")?.explanation).toContain("domain-cheap's domain");
    expect(fillTemplate(index, { hosting: "host-serverless" }, "{hosting}'s free plan")).toBe("host-serverless' free plan");
    expect(find(evaluatePlan(index, { hosting: "host-server", scraping: "scrape-lib" }, input()), "self-run-scraper-on-serverless")).toBeUndefined();
    expect(find(evaluatePlan(index, { hosting: "host-serverless", scraping: "scrape-api" }, input()), "self-run-scraper-on-serverless")).toBeUndefined();
    expect(find(evaluatePlan(index, { scraping: "scrape-api" }, input({ scrapes_sites: "yes" })), "scraper-javascript-costs-extra")?.level).toBe("info");
  });

  it("notes free hosts that sleep and hosts that charge for your own domain", () => {
    const results = evaluatePlan(index, { hosting: "host-server", domain: "domain-cheap" }, input());
    expect(find(results, "free-host-sleeps")?.level).toBe("info");
    expect(find(results, "own-domain-needs-paid-host")?.level).toBe("warning");
    expect(find(evaluatePlan(index, { hosting: "host-serverless", domain: "domain-cheap" }, input()), "own-domain-needs-paid-host")).toBeUndefined();
  });

  it("checks the phone app against login, database and the framework", () => {
    const results = evaluatePlan(index, { framework: "fw-server", login: "login-lib", database: "db-file", mobile: "mobile-other" }, input());
    expect(find(results, "mobile-app-login")?.level).toBe("warning");
    expect(find(results, "mobile-app-database")?.level).toBe("info");
    expect(find(results, "mobile-react-split")?.level).toBe("info");
    expect(find(results, "ios-builds-need-a-mac")?.level).toBe("info");
    const shared = evaluatePlan(index, { framework: "fw-server", mobile: "mobile-react" }, input());
    expect(find(shared, "mobile-react-shared")?.level).toBe("info");
    expect(find(shared, "ios-builds-need-a-mac")).toBeUndefined();
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
