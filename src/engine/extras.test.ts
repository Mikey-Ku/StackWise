import { describe, expect, it } from "vitest";
import { adaptEnvName, buildChecklist, checklistProgress } from "./checklist";
import { costBySize } from "./cost";
import { buildDecisionRecord, slotReasoning } from "./decisions";
import { decodeSharedPlan, encodeSharedPlan, type SharedPlan } from "./share";
import { daysBetween, isStale, staleFacts } from "./staleness";
import { fixtureCatalog, fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();

describe("staleness", () => {
  it("counts days and flags facts older than the limit", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    const fact = { value: true, note: "n", source: "https://example.com", retrieved: "2026-01-01", status: "draft" as const };
    expect(isStale(fact, "2026-04-01")).toBe(false);
    expect(isStale(fact, "2026-06-01")).toBe(true);
  });

  it("lists every stale fact in the catalog", () => {
    expect(staleFacts(fixtureCatalog(), "2026-09-16")).toEqual([]);
    const stale = staleFacts(fixtureCatalog(), "2027-03-01");
    expect(stale.length).toBeGreaterThan(0);
    expect(stale[0]).toMatchObject({ retrieved: "2026-09-15" });
  });
});

describe("checklist", () => {
  const selection = { framework: "fw-server", hosting: "host-server", database: "db-hosted", jobs: "jobs-durable" };

  it("orders setup and build tasks with hosting last", () => {
    const list = buildChecklist(index, selection);
    expect(list.build.map((i) => i.slot)).toEqual(["framework", "database", "jobs", "hosting"]);
    expect(list.setup[0]).toMatchObject({ id: "setup:fw-server:0", env: ["FW_SERVER_KEY"] });
  });

  it("gives an unresearched option a quickstart step instead of nothing", () => {
    const list = buildChecklist(index, { hosting: "host-partial" });
    expect(list.setup[0].text).toContain("official quickstart");
  });

  it("renames browser-visible variables for the plan's framework", () => {
    expect(adaptEnvName("NEXT_PUBLIC_SUPABASE_URL", "sveltekit")).toBe("PUBLIC_SUPABASE_URL");
    expect(adaptEnvName("NEXT_PUBLIC_SUPABASE_URL", "react-vite")).toBe("VITE_SUPABASE_URL");
    expect(adaptEnvName("NEXT_PUBLIC_SUPABASE_URL", "nextjs")).toBe("NEXT_PUBLIC_SUPABASE_URL");
    expect(adaptEnvName("STRIPE_SECRET_KEY", "sveltekit")).toBe("STRIPE_SECRET_KEY");
  });

  it("counts progress from checked ids", () => {
    const list = buildChecklist(index, selection);
    const checked = { [list.setup[0].id]: true, [list.build[0].id]: true, "setup:gone:0": true };
    expect(checklistProgress(list, checked)).toEqual({ done: 2, total: list.setup.length + list.build.length });
  });
});

describe("cost by size", () => {
  it("prices the plan at every audience size", () => {
    const sizes = costBySize(index, { hosting: "host-server", database: "db-hosted" }, input());
    expect(sizes.map((s) => s.size)).toEqual(["just_me", "up_to_100", "up_to_1000", "more"]);
    expect(sizes.map((s) => s.monthlyUsd)).toEqual([0, 7, 7, 32]);
  });
});

describe("share links", () => {
  const plan: SharedPlan = {
    v: 1,
    appName: "Fade",
    description: "A booking app for a barber shop, with deposits and reminders.",
    features: "Pick a time\nPay a deposit",
    answers: { saves_data: "yes", users_pay: "yes", live_updates: "not_sure" },
    size: "up_to_100",
    priority: "launch_fast",
    builderId: "claude-code",
    pinned: { hosting: "host-server", login: "" },
    notes: { hosting: { text: "Set the region to Frankfurt.", optionId: "host-server", updatedAt: "2026-09-16T10:00:00.000Z", by: "you" } },
  };

  it("round-trips a plan through a compact, URL-safe token", async () => {
    const token = await encodeSharedPlan(plan);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeSharedPlan(token)).toEqual(plan);
  });

  it("still opens a link made before notes existed", async () => {
    const older: Partial<SharedPlan> = { ...plan };
    delete older.notes;
    // Encoded by hand, the way the first release did, so no schema fills the notes in first.
    const piped = new Blob([new TextEncoder().encode(JSON.stringify(older))]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const token = Buffer.from(await new Response(piped).arrayBuffer()).toString("base64url");
    expect(await decodeSharedPlan(token)).toEqual({ ...older, notes: {} });
  });

  it("rejects tokens that aren't plans instead of throwing", async () => {
    expect(await decodeSharedPlan("not-a-plan")).toBeNull();
    const tampered = await encodeSharedPlan({ ...plan, appName: "x" });
    expect(await decodeSharedPlan(tampered.slice(0, -4))).toBeNull();
  });
});

describe("decision record", () => {
  const plan = input({ saves_data: "yes", users_pay: "yes" }, { priority: "spend_zero" });
  const selection = { framework: "fw-server", hosting: "host-serverless", database: "db-hosted", payments: "pay-card" };

  it("explains one part with checks, alternatives and what would change it", () => {
    const text = slotReasoning(index, plan, selection, "hosting")!;
    expect(text).toContain("## Hosting: host-serverless");
    expect(text).toContain("**Status:** works with a warning.");
    expect(text).toContain("free plan doesn't allow charging customers");
    expect(text).toContain("| host-server |");
    expect(text).toContain("https://example.com/fixture");
  });

  it("covers every filled slot in build order and never writes an em dash", () => {
    const record = buildDecisionRecord(index, plan, selection, { appName: "Fade", generatedOn: "2026-09-15" });
    const order = ["## Framework", "## Database", "## Payments", "## Hosting"].map((h) => record.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(record).not.toContain("\u2014");
  });

  it("returns nothing for an empty slot", () => {
    expect(slotReasoning(index, plan, selection, "ai")).toBeNull();
  });
});
