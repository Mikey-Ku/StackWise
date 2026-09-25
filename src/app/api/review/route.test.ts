import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

/**
 * The review route answers this computer only and doesn't exist on a hosted StackWise. These
 * tests read the real catalog but never send a decision that could land: every POST here is one
 * the route must refuse, and the last check makes sure data/ is byte for byte what it was. The
 * writing itself is tested on temp copies in src/engine/review-store.test.ts.
 */

const URL = "http://localhost:4310/api/review";
const headers = (extra: Record<string, string> = {}) => ({ host: "localhost:4310", ...extra });
const get = (extra: Record<string, string> = {}) => GET(new Request(URL, { headers: headers(extra) }));
const post = (body: unknown, extra: Record<string, string> = {}) =>
  POST(new Request(URL, { method: "POST", headers: headers({ "content-type": "application/json", ...extra }), body: JSON.stringify(body) }));

const optionsDir = path.join(process.cwd(), "data", "options");
const snapshot = () => Object.fromEntries(fs.readdirSync(optionsDir).map((name) => [name, fs.readFileSync(path.join(optionsDir, name), "utf8")]));
let before: Record<string, string>;

beforeAll(() => {
  before = snapshot();
});

afterEach(() => {
  delete process.env.STACKWISE_HOSTED;
  delete process.env.STACKWISE_PAIRING;
});

afterAll(() => {
  expect(snapshot()).toEqual(before);
});

describe("GET /api/review", () => {
  it("lists the facts behind the default plans first, with counts", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    const { items, counts, defaults } = body;
    expect(defaults).toEqual(expect.arrayContaining(["Web app", "Online store", "Pitchwell example"]));
    expect(counts.total).toBe(items.length);
    expect(counts.behindDefaults).toBeGreaterThan(0);
    expect(counts.behindDefaults).toBeLessThan(counts.total);
    expect(items.slice(0, counts.behindDefaults).every((i: { tier: string }) => i.tier === "defaults")).toBe(true);
    expect(items[0]).toEqual(
      expect.objectContaining({ optionId: expect.any(String), fact: expect.any(String), label: expect.any(String), source: expect.stringMatching(/^https?:\/\//), why: expect.stringMatching(/^(Decides|Checked)/) }),
    );
  });

  it("answers only this computer", async () => {
    expect((await get({ origin: "https://evil.example" })).status).toBe(403);
    expect((await GET(new Request(URL, { headers: { host: "stackwise.example.com" } }))).status).toBe(403);
  });
});

describe("POST /api/review", () => {
  it("refuses unknown options and facts before touching anything", async () => {
    expect((await post({ optionId: "no-such-option", fact: "portability", decision: "confirm" })).status).toBe(404);
    const unknownFact = await post({ optionId: "nextjs", fact: "no_such_fact", decision: "confirm" });
    expect(unknownFact.status).toBe(404);
    expect((await unknownFact.json()).error).toContain("no fact");
  });

  it("refuses a body it can't read", async () => {
    expect((await post({ optionId: "nextjs", fact: "portability", decision: "approve" })).status).toBe(400);
    expect((await post({ optionId: "../nextjs", fact: "portability", decision: "confirm" })).status).toBe(400);
    expect((await post({ optionId: "nextjs", fact: "portability", decision: "flag", comment: "x".repeat(5000) })).status).toBe(400);
  });

  it("refuses other sites, and anything but JSON", async () => {
    expect((await post({ optionId: "nextjs", fact: "portability", decision: "confirm" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ optionId: "nextjs", fact: "portability", decision: "confirm" }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    const form = await POST(new Request(URL, { method: "POST", headers: headers({ "content-type": "text/plain" }), body: "{}" }));
    expect(form.status).toBe(415);
  });

  it("doesn't exist on a hosted StackWise, or with pairing off", async () => {
    process.env.STACKWISE_HOSTED = "1";
    expect((await get()).status).toBe(404);
    expect((await post({ optionId: "nextjs", fact: "portability", decision: "confirm" })).status).toBe(404);
    delete process.env.STACKWISE_HOSTED;
    process.env.STACKWISE_PAIRING = "off";
    expect((await post({ optionId: "nextjs", fact: "portability", decision: "confirm" })).status).toBe(404);
  });
});
