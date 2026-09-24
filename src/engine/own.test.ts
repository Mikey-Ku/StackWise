import { describe, expect, it } from "vitest";
import { buildChecklist } from "./checklist";
import { costLine } from "./cost";
import { isOwn, ownId } from "./own";
import { recommend } from "./score";
import { buildSpecPack } from "./spec";
import { planStats } from "./stats";
import { fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();
const plan = input({ saves_data: "yes", login: "yes" });

describe("building a part yourself", () => {
  it("is never picked by StackWise, only by the person", () => {
    const rec = recommend(index, plan);
    expect(Object.values(rec.selection).some((id) => isOwn(id))).toBe(false);
    const own = recommend(index, plan, { database: ownId("database") });
    expect(own.selection.database).toBe("own-database");
    expect(own.autoPicked).not.toContain("database");
  });

  it("is never 'works': checks on it are unknown, it has no price and no account", () => {
    const rec = recommend(index, plan, { database: ownId("database") });
    const onIt = rec.results.filter((r) => r.slots.includes("database"));
    expect(onIt.length).toBeGreaterThan(0);
    expect(onIt.find((r) => r.source === "coverage")).toMatchObject({ level: "unknown", title: "Your own database isn't checked" });
    expect(costLine(index, index.optionsById.get("own-database")!, "database", plan)).toMatchObject({ kind: "unknown", headline: "Yours to run, not priced" });
    const withService = planStats(index, plan, recommend(index, plan));
    const withOwn = planStats(index, plan, rec);
    expect(withOwn.accounts).toBeLessThanOrEqual(withService.accounts);
    expect(index.optionsById.has("own-framework")).toBe(false);
  });

  it("gets its own setup and build steps, and a spec section on what it has to handle", () => {
    const selection = { ...recommend(index, plan).selection, database: "own-database" };
    const list = buildChecklist(index, selection);
    expect(list.setup.find((i) => i.optionId === "own-database")?.text).toBe("Get your own database running, and put how the app reaches it (an address, a key) in environment variables.");
    expect(list.build.find((i) => i.optionId === "own-database")?.text).toBe("Build your own database and connect the app to it. SPEC.md lists what it has to handle.");
    const details = { appName: "Fade", description: "d", features: "", builderId: "claude-code", generatedOn: "2026-09-24", notes: { database: { text: "Postgres on our office server.", updatedAt: "2026-09-24", by: "you" as const } } };
    const spec = buildSpecPack(index, plan, selection, details)[0].content;
    expect(spec).toContain("## Parts you're building yourself");
    expect(spec).toContain("What it is: Postgres on our office server.");
    expect(spec).toContain("What it has to handle:");
  });
});
