import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyReview, FLAGS_FILE, readFlags, reviewHidden } from "./review-store";
import { fixtureOptions } from "./test-fixtures";

/**
 * What a review decision does on disk, against temp copies of fixture option files. Nothing here
 * reads or writes the real data/ folder.
 */

let root: string;
let dataDir: string;
let stateDir: string;
const option = fixtureOptions.find((o) => o.id === "host-server")!;
const file = () => path.join(dataDir, "options", "host-server.json");
const original = `${JSON.stringify(option, null, 2)}\n`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "stackwise-review-"));
  dataDir = path.join(root, "data");
  stateDir = path.join(root, ".stackwise");
  fs.mkdirSync(path.join(dataDir, "options"), { recursive: true });
  fs.writeFileSync(file(), original);
  fs.writeFileSync(path.join(dataDir, "options", "db-file.json"), `${JSON.stringify(fixtureOptions.find((o) => o.id === "db-file"), null, 2)}\n`);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const confirm = (fact: string, today = "2026-09-24") => applyReview(dataDir, stateDir, { optionId: "host-server", fact, decision: "confirm" }, today);
const flag = (fact: string, comment?: string) => applyReview(dataDir, stateDir, { optionId: "host-server", fact, decision: "flag", comment }, "2026-09-24");

describe("applyReview", () => {
  it("confirming marks that one fact verified with the day, and changes nothing else in the file", () => {
    expect(confirm("persistent_disk")).toEqual({ ok: true, key: "host-server.persistent_disk", status: "verified", reviewed: "2026-09-24" });
    const text = fs.readFileSync(file(), "utf8");
    expect(text.replace('"status": "verified",\n      "reviewed": "2026-09-24"', '"status": "draft"')).toBe(original);
    expect(JSON.parse(text).facts.persistent_disk).toEqual({ ...option.facts.persistent_disk, status: "verified", reviewed: "2026-09-24" });
    // The other option file is untouched.
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "options", "db-file.json"), "utf8"))).toEqual(fixtureOptions.find((o) => o.id === "db-file"));
  });

  it("flagging leaves the fact a draft and logs the comment outside data/", () => {
    const result = flag("free_plan_sleeps", "  The page says it sleeps after 15 minutes.  ");
    expect(result).toEqual({
      ok: true,
      key: "host-server.free_plan_sleeps",
      status: "draft",
      flag: { comment: "The page says it sleeps after 15 minutes.", flagged: "2026-09-24", value: true, retrieved: "2026-09-15" },
    });
    expect(fs.readFileSync(file(), "utf8")).toBe(original);
    expect(readFlags(stateDir)).toEqual({ "host-server.free_plan_sleeps": expect.objectContaining({ comment: "The page says it sleeps after 15 minutes." }) });
    expect(fs.existsSync(path.join(stateDir, FLAGS_FILE))).toBe(true);
  });

  it("flagging a verified fact puts it back to draft, and confirming clears the flag", () => {
    confirm("scheduled_jobs");
    flag("scheduled_jobs", "Cron needs a paid plan now.");
    expect(fs.readFileSync(file(), "utf8")).toBe(original);
    expect(readFlags(stateDir)["host-server.scheduled_jobs"]).toBeDefined();

    confirm("scheduled_jobs", "2026-09-25");
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).facts.scheduled_jobs).toMatchObject({ status: "verified", reviewed: "2026-09-25" });
    expect(readFlags(stateDir)).toEqual({});
  });

  it("refuses options and facts the data doesn't have, and ids that aren't ids", () => {
    expect(applyReview(dataDir, stateDir, { optionId: "nope", fact: "portability", decision: "confirm" }, "2026-09-24")).toMatchObject({ ok: false, code: 404 });
    expect(confirm("no_such_fact")).toMatchObject({ ok: false, code: 404 });
    expect(confirm("constructor")).toMatchObject({ ok: false, code: 404 });
    expect(applyReview(dataDir, stateDir, { optionId: "../host-server", fact: "portability", decision: "confirm" }, "2026-09-24")).toMatchObject({ ok: false, code: 400 });
    expect(applyReview(dataDir, stateDir, { optionId: "host-server", fact: "portability", decision: "confirm" }, "tomorrow")).toMatchObject({ ok: false, code: 400 });
    expect(fs.readFileSync(file(), "utf8")).toBe(original);
    expect(fs.existsSync(stateDir)).toBe(false);
  });

  it("refuses a file whose id isn't its name", () => {
    fs.writeFileSync(path.join(dataDir, "options", "other.json"), original);
    expect(applyReview(dataDir, stateDir, { optionId: "other", fact: "portability", decision: "confirm" }, "2026-09-24")).toMatchObject({ ok: false, code: 400 });
  });
});

describe("readFlags and reviewHidden", () => {
  it("reads a missing or broken log as no flags", () => {
    expect(readFlags(stateDir)).toEqual({});
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, FLAGS_FILE), "not json");
    expect(readFlags(stateDir)).toEqual({});
  });

  it("is hidden on a hosted StackWise", () => {
    expect(reviewHidden({})).toBe(false);
    expect(reviewHidden({ STACKWISE_HOSTED: "1" })).toBe(true);
    expect(reviewHidden({ NEXT_PUBLIC_STACKWISE_HOSTED: "1" })).toBe(true);
    expect(reviewHidden({ STACKWISE_HOSTED: "0" })).toBe(false);
  });
});
