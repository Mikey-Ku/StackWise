import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SharedPlan } from "@/engine/share";
import { fixtureIndex } from "@/engine/test-fixtures";
import { createRegistry, type Registry } from "./registry";
import { createWhyStackServer } from "./server";

const index = fixtureIndex();

const basePlan: SharedPlan = {
  v: 1,
  appName: "Fade",
  description: "A booking app for a barber shop.",
  features: "",
  answers: { saves_data: "yes", login: "yes" },
  size: "up_to_100",
  priority: "spend_zero",
  builderId: "claude-code",
  pinned: {},
};

let dir: string;
let registry: Registry;
let client: Client;
let saved: string[];

async function connect(planId: string | null) {
  const server = createWhyStackServer({
    index: () => index,
    registry,
    planId: () => planId,
    afterSave: (record) => saved.push(record.id),
    whystackRoot: "/opt/whystack",
    where: "app",
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "whystack-mcp-"));
  registry = createRegistry(dir);
  saved = [];
});

afterEach(async () => {
  await client?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("MCP server", () => {
  it("offers the advisor and plan tools, with read-only hints on the ones that don't change anything", async () => {
    await connect(null);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["check_stack", "compare_options", "estimate_costs", "export_project", "get_option", "get_plan", "list_parts", "recommend_stack", "search_options", "setup_steps", "update_plan"].sort(),
    );
    expect(tools.find((t) => t.name === "update_plan")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === "check_stack")?.annotations?.readOnlyHint).toBe(true);
  });

  it("checks a stack with the rules instead of guessing", async () => {
    await connect(null);
    const { data } = await call("check_stack", { stack: { hosting: "host-serverless", database: "db-file" } });
    expect(data.verdict).toBe("blocked");
    expect(data.checks[0]).toMatchObject({ level: "blocked", rule: "file-database-needs-disk" });

    const wrong = await call("check_stack", { stack: { hosting: "db-file" } });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain("can't fill hosting");
  });

  it("explains how to share a plan when none is shared", async () => {
    await connect(null);
    const result = await call("get_plan");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Pair with Claude");
  });

  it("changes the shared plan, logs why, and returns the new checks", async () => {
    registry.savePlan("p1", basePlan, "browser");
    await connect("p1");

    const result = await call("update_plan", { note: "They want reminders by email", answers: { sends_email: "yes" }, parts: { domain: "domain-cheap" } });
    expect(result.data.changes).toEqual(['Answered "Will the app send emails, like confirmations, receipts or reminders?" yes', "Put domain-cheap in Domain name"]);
    expect(result.data.plan.stack.find((p: { part: string }) => p.part === "domain")).toMatchObject({ option_id: "domain-cheap", picked_by: "you" });

    const record = registry.read("p1")!;
    expect(record).toMatchObject({ version: 2, updatedBy: "claude" });
    expect(record.plan.pinned.domain).toBe("domain-cheap");
    expect(record.activity.at(-1)).toMatchObject({ tool: "update_plan", summary: "They want reminders by email" });
    expect(saved).toEqual(["p1"]);
  });

  it("refuses a change the planner would refuse, and saves nothing", async () => {
    registry.savePlan("p1", basePlan, "browser");
    await connect("p1");
    const result = await call("update_plan", { note: "Try a database as a host", parts: { hosting: "db-file" }, answers: { nonsense: "yes" } });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('There\'s no question "nonsense"');
    expect(result.text).toContain("goes in Database, not Hosting");
    expect(registry.read("p1")!.version).toBe(1);
  });

  it("shows read-only results on the shared plan too", async () => {
    registry.savePlan("p1", basePlan, "browser");
    await connect("p1");
    await call("compare_options", { part: "login", option_ids: ["login-acme", "login-lib"], stack: { database: "db-hosted" }, answers: { login: "yes" } });
    expect(registry.read("p1")!.activity.at(-1)).toMatchObject({ tool: "compare_options", summary: "Compared login-acme, login-lib for Login" });
  });

  it("exports the project files, with an MCP config that points back at WhyStack", async () => {
    registry.savePlan("p1", basePlan, "browser");
    await connect("p1");
    const { data } = await call("export_project");
    const paths = data.files.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["SPEC.md", "SETUP.md", "TASKS.md", "CLAUDE.md", "DECISIONS.md", "whystack.plan.json", ".mcp.json", ".claude/settings.json", ".claude/agents/stack-guard.md", ".claude/skills/next-step/SKILL.md"]));
    const mcp = JSON.parse(data.files.find((f: { path: string }) => f.path === ".mcp.json").content);
    expect(mcp.mcpServers.whystack).toEqual({ command: "pnpm", args: ["--silent", "--dir", "/opt/whystack", "mcp"] });
  });
});
