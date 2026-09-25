import { afterEach, describe, expect, it } from "vitest";
import { localOnly, readJson, sameOrigin } from "./local";

const request = (headers: Record<string, string>, method = "POST") =>
  new Request("http://localhost:4310/api/mcp", { method, headers: { "content-type": "application/json", ...headers } });

afterEach(() => {
  delete process.env.STACKWISE_PAIRING;
});

describe("local-only guard", () => {
  it("answers StackWise's own page and programs on this computer", () => {
    expect(localOnly(request({ host: "localhost:4310" }))).toBeNull();
    expect(localOnly(request({ host: "127.0.0.1:4310", origin: "http://localhost:4310", "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(localOnly(request({ host: "[::1]:4310" }))).toBeNull();
  });

  it("refuses other host names, other sites and other apps on this computer", async () => {
    expect(localOnly(request({ host: "stackwise.evil.example" }))?.status).toBe(403);
    const fromWebsite = localOnly(request({ host: "localhost:4310", origin: "https://evil.example" }));
    expect(fromWebsite?.status).toBe(403);
    expect(await fromWebsite?.json()).toEqual({ error: "StackWise only answers its own page." });
    // Another dev server on this computer is a different origin, even on localhost.
    expect(localOnly(request({ host: "localhost:4310", origin: "http://localhost:5173" }))?.status).toBe(403);
    expect(localOnly(request({ host: "localhost:4310", origin: "null" }))?.status).toBe(403);
    expect(localOnly(request({ host: "localhost:4310", "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(localOnly(request({ host: "localhost:4310", "sec-fetch-site": "same-site" }))?.status).toBe(403);
  });

  it("only takes JSON in a POST, so another page can't skip the browser's preflight", () => {
    expect(localOnly(request({ host: "localhost:4310", "content-type": "text/plain" }))?.status).toBe(415);
    expect(sameOrigin(request({ host: "localhost:4310", "content-type": "" }, "GET"))).toBeNull();
  });

  it("can be turned off", () => {
    process.env.STACKWISE_PAIRING = "off";
    expect(localOnly(request({ host: "localhost:4310" }))?.status).toBe(404);
    expect(sameOrigin(request({ host: "localhost:4310" }))).toBeNull();
  });

  it("reads a JSON body up to a limit", async () => {
    const body = (text: string) => new Request("http://localhost:4310/api/x", { method: "POST", body: text });
    expect(await readJson(body('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(body("not json"))).toBeNull();
    expect(await readJson(body(JSON.stringify({ a: "x".repeat(100) })), 50)).toBeNull();
  });
});

describe("the hosted copy", () => {
  const hostedRequest = (headers: Record<string, string>, method = "POST") =>
    new Request("https://stackwise.example/api/talk", { method, headers: { "content-type": "application/json", ...headers } });

  it("turns off everything that reaches into a computer", async () => {
    const refused = localOnly(hostedRequest({ host: "localhost:4310" }), true);
    expect(refused?.status).toBe(404);
    expect(await refused?.json()).toEqual({ error: "This only works when StackWise runs on your own computer." });
  });

  it("answers its own page under its public name, and programs", () => {
    expect(sameOrigin(hostedRequest({ host: "stackwise.example", origin: "https://stackwise.example", "sec-fetch-site": "same-origin" }), true)).toBeNull();
    expect(sameOrigin(hostedRequest({ host: "stackwise.example" }), true)).toBeNull();
  });

  it("still refuses other sites and form posts", () => {
    expect(sameOrigin(hostedRequest({ host: "stackwise.example", origin: "https://evil.example" }), true)?.status).toBe(403);
    expect(sameOrigin(hostedRequest({ host: "stackwise.example", "sec-fetch-site": "cross-site" }), true)?.status).toBe(403);
    expect(sameOrigin(hostedRequest({ host: "stackwise.example", "content-type": "text/plain" }), true)?.status).toBe(415);
  });
});
