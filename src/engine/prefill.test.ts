import { describe, expect, it } from "vitest";
import { prefillFromKeywords } from "./prefill";
import { fixtureCatalog } from "./test-fixtures";

const { needs } = fixtureCatalog();

describe("keyword pre-fill", () => {
  it("guesses needs from a plain description and records the words it matched", () => {
    const guesses = prefillFromKeywords(
      "A booking app for my barber shop. Customers pick a time, pay a deposit, upload a photo of the haircut they want, and get a reminder the day before.",
      needs,
    );
    expect(guesses).toMatchObject({
      saves_data: "booking",
      users_pay: "pay",
      uploads: "upload",
      scheduled_tasks: "reminder",
    });
    expect(guesses.ai_features).toBeUndefined();
  });

  it("matches whole words, so 'said' and 'explain' are not AI", () => {
    expect(prefillFromKeywords("My friend said I should explain things simply.", needs).ai_features).toBeUndefined();
    expect(prefillFromKeywords("Add an AI helper that answers questions.", needs).ai_features).toBe("AI");
  });

  it("matches word endings for starred keywords", () => {
    expect(prefillFromKeywords("Monthly subscriptions for premium members", needs)).toMatchObject({
      users_pay: "subscriptions",
      login: "members",
    });
  });

  it("never guesses no", () => {
    const guesses = prefillFromKeywords("A simple landing page.", needs);
    expect(Object.values(guesses).every((v) => typeof v === "string")).toBe(true);
    expect(guesses.login).toBeUndefined();
  });
});
