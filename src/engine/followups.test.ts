import { describe, expect, it } from "vitest";
import { headsUps, questionsThatMatter } from "./followups";
import { fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();

describe("follow-up questions", () => {
  it("asks at most five unanswered questions", () => {
    const asked = questionsThatMatter(index, input({ saves_data: "yes" }));
    expect(asked.length).toBeLessThanOrEqual(5);
    expect(asked).not.toContain("saves_data");
  });

  it("skips a question whose answer can't change the plan", () => {
    // No login and no database: a future phone app changes nothing about this plan.
    const answers = { saves_data: "no", login: "no", users_pay: "no", uploads: "no", live_updates: "no", long_jobs: "no", scheduled_tasks: "no", ai_features: "no" } as const;
    expect(questionsThatMatter(index, input({ ...answers }))).not.toContain("might_go_mobile");
  });

  it("asks a question that would change the plan", () => {
    expect(questionsThatMatter(index, input({}))).toContain("users_pay");
  });

  it("explains what a 'not sure' would change if it turns out to be yes", () => {
    const [headsUp] = headsUps(index, input({ users_pay: "not_sure" }));
    expect(headsUp.needId).toBe("users_pay");
    expect(headsUp.changes).toContain("Adds Payments: pay-card");
  });
});
