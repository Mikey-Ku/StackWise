import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SharedPlan } from "@/engine/share";
import { createRegistry } from "./registry";

const plan: SharedPlan = { v: 1, appName: "Fade", description: "", features: "", answers: {}, size: "up_to_100", priority: "spend_zero", builderId: "claude-code", pinned: {}, notes: {} };
const dirs: string[] = [];
const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stackwise-registry-"));
  dirs.push(dir);
  return createRegistry(dir);
};

afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("shared plan registry", () => {
  it("bumps the version only when the plan itself changes, and always moves touchedAt forward", () => {
    const registry = fresh();
    const first = registry.savePlan("p1", plan, "browser");
    const same = registry.savePlan("p1", plan, "claude");
    const changed = registry.savePlan("p1", { ...plan, appName: "Fade Pro" }, "claude");
    expect([first.version, same.version, changed.version]).toEqual([1, 1, 2]);
    expect(same.updatedBy).toBe("browser");
    expect(changed.updatedBy).toBe("claude");
    expect(Date.parse(changed.touchedAt)).toBeGreaterThan(Date.parse(same.touchedAt));
    expect(Date.parse(same.touchedAt)).toBeGreaterThan(Date.parse(first.touchedAt));
  });

  it("keeps the latest activity, and remembers which plan is shared", () => {
    const registry = fresh();
    registry.savePlan("p1", plan, "browser");
    for (let i = 0; i < 105; i++) registry.addActivity("p1", { tool: "check_stack", summary: `check ${i}`, changes: [] });
    const record = registry.read("p1")!;
    expect(record.activity).toHaveLength(100);
    expect(record.activity.at(-1)?.summary).toBe("check 104");
    expect(registry.addActivity("missing", { tool: "x", summary: "y", changes: [] })).toBeNull();

    expect(registry.activeId()).toBeNull();
    registry.setActive("p1");
    expect(registry.activeId()).toBe("p1");
    registry.setActive(null);
    expect(registry.activeId()).toBeNull();
    expect(registry.list().map((r) => r.id)).toEqual(["p1"]);
  });

  it("refuses plan ids that could escape its folder", () => {
    expect(() => fresh().savePlan("../evil", plan, "browser")).toThrow("isn't a valid plan id");
    expect(fresh().read("../evil")).toBeNull();
  });

  it("keeps older plan files readable, with an empty conversation", () => {
    const registry = fresh();
    const record = registry.savePlan("p1", plan, "browser");
    const file = path.join(registry.dir, "plans", "p1.json");
    const old: Partial<typeof record> = { ...record };
    delete old.messages;
    delete old.agents;
    fs.writeFileSync(file, JSON.stringify(old));
    expect(registry.read("p1")).toMatchObject({ messages: [], agents: {} });
  });

  it("delivers each message once, to the agent it's addressed to, and keeps the conversation when the plan changes", () => {
    const registry = fresh();
    expect(registry.postMessage("p1", { agent: "claude-code", text: "hi" })).toBeNull();
    registry.savePlan("p1", plan, "browser");
    registry.postMessage("p1", { agent: "claude-code", text: "one" });
    registry.postMessage("p1", { agent: "codex", text: "two" });
    registry.savePlan("p1", { ...plan, appName: "Fade 2" }, "browser");
    expect(registry.takeMessages("p1", "claude-code", "2026-09-22T10:00:00.000Z").map((m) => m.text)).toEqual(["one"]);
    expect(registry.takeMessages("p1", "claude-code", "2026-09-22T10:00:01.000Z")).toEqual([]);
    registry.agentReply("p1", { agent: "claude-code", text: "on it", status: "working" });
    const record = registry.read("p1")!;
    expect(record.messages.map((m) => [m.from, m.agent, m.text, Boolean(m.deliveredAt)])).toEqual([
      ["you", "claude-code", "one", true],
      ["you", "codex", "two", false],
      ["agent", "claude-code", "on it", false],
    ]);
  });

  it("refuses agent ids that aren't tidy slugs", () => {
    const registry = fresh();
    registry.savePlan("p1", plan, "browser");
    expect(() => registry.postMessage("p1", { agent: "../evil", text: "x" })).toThrow();
  });
});
