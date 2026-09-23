import { describe, expect, it } from "vitest";
import { mergePlans } from "./merge";
import type { SharedPlan } from "./share";

const base: SharedPlan = {
  v: 1,
  appName: "Wheelhouse",
  description: "A fantasy football wheel.",
  features: "",
  answers: { saves_data: "yes", outside_data: "yes" },
  size: "up_to_100",
  priority: "spend_zero",
  builderId: "claude-code",
  pinned: { framework: "spring-boot", hosting: "render" },
  notes: {},
};

describe("merging two copies of a plan", () => {
  it("keeps a note from one side and a swapped part from the other", () => {
    const browser = { ...base, notes: { hosting: { text: "Render's disk is wiped on deploy.", updatedAt: "2026-09-23T10:00:00.000Z", by: "you" as const } } };
    const terminal = { ...base, pinned: { ...base.pinned, database: "supabase-db" } };
    const { plan, conflicts } = mergePlans(base, terminal, browser, true);
    expect(plan.pinned).toEqual({ framework: "spring-boot", hosting: "render", database: "supabase-db" });
    expect(plan.notes.hosting?.text).toBe("Render's disk is wiped on deploy.");
    expect(conflicts).toEqual([]);
  });

  it("lets the newer side win only where both changed the same thing, and says which", () => {
    const ours = { ...base, appName: "Wheelhouse Live", answers: { ...base.answers, login: "yes" as const } };
    const theirs = { ...base, appName: "Wheel", answers: { ...base.answers, live_updates: "yes" as const } };
    const newerOurs = mergePlans(base, ours, theirs, true);
    expect(newerOurs.plan.appName).toBe("Wheelhouse Live");
    expect(newerOurs.plan.answers).toEqual({ saves_data: "yes", outside_data: "yes", login: "yes", live_updates: "yes" });
    expect(newerOurs.conflicts).toEqual(["appName"]);
    expect(mergePlans(base, ours, theirs, false).plan.appName).toBe("Wheel");
  });

  it("keeps a removal made on one side", () => {
    const { plan } = mergePlans(base, { ...base, pinned: { framework: "spring-boot" } }, base, false);
    expect(plan.pinned).toEqual({ framework: "spring-boot" });
  });
});
