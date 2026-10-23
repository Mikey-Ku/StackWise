import { describe, expect, it } from "vitest";
import { describeAgentModel, wantsLongContext } from "./answerers";

const known = [
  { id: "claude-opus-5-5", name: "Opus 5.5" },
  { id: "claude-fable-5-1", name: "Fable 5.1" },
];

describe("describeAgentModel", () => {
  it("resolves an alias with the 1M suffix to the model's name and a note", () => {
    expect(describeAgentModel("opus[1m]", known)).toEqual({ id: "claude-opus-5-5", name: "Opus 5.5", note: "1M", raw: "opus[1m]" });
    expect(wantsLongContext("opus[1m]")).toBe(true);
  });
  it("names a full id, from the catalog or from the id itself", () => {
    expect(describeAgentModel("claude-fable-5-1", known)?.name).toBe("Fable 5.1");
    expect(describeAgentModel("claude-sonnet-5-5", known)).toMatchObject({ id: "claude-sonnet-5-5", name: "Sonnet 5.5", note: null });
    expect(describeAgentModel("claude-haiku-5-5-20260301[1M]", known)).toMatchObject({ name: "Haiku 5.5", note: "1M" });
  });
  it("reads opusplan as Opus with a plan note", () => {
    expect(describeAgentModel("opusplan", known)).toMatchObject({ id: "claude-opus-5-5", name: "Opus 5.5", note: "plan" });
  });
  it("keeps a value it doesn't know, and treats default and nothing as the default", () => {
    expect(describeAgentModel("gpt-7", known)).toMatchObject({ id: "gpt-7", name: "gpt-7", note: null });
    expect(describeAgentModel("default", known)).toMatchObject({ id: null, name: "Default model" });
    expect(describeAgentModel(null, known)).toBeNull();
    expect(describeAgentModel("  ", known)).toBeNull();
    expect(wantsLongContext(null)).toBe(false);
  });
});
