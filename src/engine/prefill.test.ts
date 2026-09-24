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

  it("doesn't read a video call as uploading videos", () => {
    const guesses = prefillFromKeywords("A tutoring app where students book a video call with a tutor and pay per lesson.", needs);
    expect(guesses.uploads).toBeUndefined();
    expect(guesses.large_uploads).toBeUndefined();
    expect(guesses.users_pay).toBe("pay");
    // A real video upload still counts, and the words it quotes come from the description.
    const upload = prefillFromKeywords("Students join a video chat, then upload a video of their homework.", needs);
    expect(upload.uploads).toBe("upload");
    expect(upload.large_uploads).toBe("video");
  });

  it("never guesses no", () => {
    const guesses = prefillFromKeywords("A simple landing page.", needs);
    expect(Object.values(guesses).every((v) => typeof v === "string")).toBe(true);
    expect(guesses.login).toBeUndefined();
  });
});
