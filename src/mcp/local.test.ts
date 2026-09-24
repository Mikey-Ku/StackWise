import { afterEach, describe, expect, it } from "vitest";
import { localOnly } from "./local";

const request = (headers: Record<string, string>) => new Request("http://localhost:4310/api/mcp", { method: "POST", headers });

afterEach(() => {
  delete process.env.STACKWISE_PAIRING;
});

describe("local-only guard", () => {
  it("answers this computer", () => {
    expect(localOnly(request({ host: "localhost:4310" }))).toBeNull();
    expect(localOnly(request({ host: "127.0.0.1:4310", origin: "http://localhost:4310" }))).toBeNull();
    expect(localOnly(request({ host: "[::1]:4310" }))).toBeNull();
  });

  it("refuses other host names and pages from other sites", async () => {
    expect(localOnly(request({ host: "stackwise.evil.example" }))?.status).toBe(403);
    const fromWebsite = localOnly(request({ host: "localhost:4310", origin: "https://evil.example" }));
    expect(fromWebsite?.status).toBe(403);
    expect(await fromWebsite?.json()).toEqual({ error: "StackWise's MCP server and pairing only answer requests from this computer." });
  });

  it("can be turned off", () => {
    process.env.STACKWISE_PAIRING = "off";
    expect(localOnly(request({ host: "localhost:4310" }))?.status).toBe(404);
  });
});
