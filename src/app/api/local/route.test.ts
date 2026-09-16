import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SharedPlan } from "@/engine/share";
import { POST } from "./route";

/** Writing a project into a folder answers this computer only, and says what it would do first. */

const plan: SharedPlan = {
  v: 1,
  appName: "Bird Count",
  description: "People log the birds they see.",
  features: "Log a sighting",
  answers: { saves_data: "yes" },
  size: "up_to_100",
  priority: "spend_zero",
  builderId: "claude-code",
  pinned: {},
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost:4310/api/local", { method: "POST", headers: { host: "localhost:4310", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

const target = path.join(os.homedir(), "whystack-route-test");

afterEach(() => {
  delete process.env.WHYSTACK_PAIRING;
});

describe("POST /api/local", () => {
  it("says what it would write, and writes nothing on a dry run", async () => {
    const response = await post({ path: target, id: "p1", plan, generatedOn: "2026-09-15", dryRun: true });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.path).toBe(target);
    expect(body.folderExists).toBe(false);
    expect(body.write).toEqual(expect.arrayContaining(["SPEC.md", "SETUP.md", ".env.example", ".gitignore", "whystack.plan.json", ".env.local"]));
    expect(body.wrote).toEqual([]);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("refuses a folder outside the home folder", async () => {
    const response = await post({ path: "/etc/whystack", id: "p1", plan, generatedOn: "2026-09-15", dryRun: true });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("only writes inside your home folder");
  });

  it("refuses a page on another site, and a body it can't read", async () => {
    expect((await post({ path: target, id: "p1", plan, generatedOn: "2026-09-15" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ path: target })).status).toBe(400);
  });

  it("can be turned off with the rest of pairing", async () => {
    process.env.WHYSTACK_PAIRING = "off";
    expect((await post({ path: target, id: "p1", plan, generatedOn: "2026-09-15", dryRun: true })).status).toBe(404);
  });
});
