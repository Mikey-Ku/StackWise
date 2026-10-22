import { describe, expect, it } from "vitest";
import { narrateChange } from "./narrate";
import { planInput } from "./planops";
import { alternativesFor, recommend } from "./score";
import type { SharedPlan } from "./share";
import { fixtureIndex } from "./test-fixtures";

const index = fixtureIndex();
const base: SharedPlan = { v: 1, appName: "Fade", description: "", features: "", answers: { saves_data: "yes" }, size: "up_to_100", priority: "spend_zero", builderId: "claude-code", pinned: {}, notes: {} };
const moment = (plan: SharedPlan) => ({ plan, rec: recommend(index, planInput(plan), plan.pinned) });

describe("the chat narrates a change", () => {
  it("says nothing when nothing worth saying changed", () => {
    expect(narrateChange(index, moment(base), moment(base))).toBeNull();
    expect(narrateChange(index, moment(base), moment({ ...base, description: "A barber shop app" }))).toBeNull();
  });

  it("tells an answer as if the person typed it, then the part it added and the cost", () => {
    const after = { ...base, answers: { ...base.answers, users_pay: "yes" as const } };
    const story = narrateChange(index, moment(base), moment(after))!;
    expect(story.you).toMatch(/^Answered yes: /);
    expect(story.facts).toMatch(/Payments: nothing to /);
    expect(story.facts).toContain("StackWise picked it");
    expect(story.facts).toContain("Cost:");
    expect(story.about).toBe("payments");
  });

  it("tells a pick the person made, with the verdict for that part", () => {
    const before = moment(base);
    const other = alternativesFor(index, planInput(base), before.rec.selection, "hosting").find((a) => a.option.id !== before.rec.selection.hosting)!.option;
    const after = moment({ ...base, pinned: { hosting: other.id } });
    const story = narrateChange(index, before, after)!;
    expect(story.you).toMatch(/^Hosting: /);
    expect(story.facts).toContain("Your pick.");
    expect(story.facts).toMatch(/Verdict for this part: (works|warning|blocked|unknown|missing|info)\./);
    expect(story.about).toBe("hosting");
  });

  it("tells a change of size, and never uses an em dash", () => {
    const story = narrateChange(index, moment(base), moment({ ...base, size: "up_to_1000" }))!;
    expect(story.you).toBe("Planned for up to 1,000 people.");
    expect(`${story.you}${story.facts}`).not.toContain("—");
  });
});
