import { describe, expect, it } from "vitest";
import { aiAllowed } from "./hosted";

describe("the built-in AI on a hosted copy", () => {
  it("is on by default on your own computer, and off when STACKWISE_AI=off", () => {
    expect(aiAllowed({})).toBe(true);
    expect(aiAllowed({ STACKWISE_AI: "off" })).toBe(false);
  });

  it("stays off on a hosted copy even with a key, until the owner turns it on", () => {
    expect(aiAllowed({ NEXT_PUBLIC_STACKWISE_HOSTED: "1", ANTHROPIC_API_KEY: "set" })).toBe(false);
    expect(aiAllowed({ NEXT_PUBLIC_STACKWISE_HOSTED: "1", STACKWISE_HOSTED_AI: "on" })).toBe(true);
    expect(aiAllowed({ NEXT_PUBLIC_STACKWISE_HOSTED: "1", STACKWISE_HOSTED_AI: "on", STACKWISE_AI: "off" })).toBe(false);
  });
});
