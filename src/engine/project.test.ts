import { describe, expect, it } from "vitest";
import { buildProjectPack } from "./project";
import { recommend } from "./score";
import type { SharedPlan } from "./share";
import { fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();
const plan = input({ saves_data: "yes", login: "yes", users_pay: "yes" });
const rec = recommend(index, plan);
const shared: SharedPlan = { v: 1, appName: "Fade", description: "Bookings for a barber shop.", features: "", answers: plan.answers, size: plan.size, priority: plan.priority, builderId: "claude-code", pinned: {}, notes: {} };
const details = { appName: "Fade", description: shared.description, features: "", builderId: "claude-code", generatedOn: "2026-09-15", planId: "fade1", plan: shared };
const byName = (files: { name: string; content: string }[]) => Object.fromEntries(files.map((f) => [f.name, f.content]));

describe("project pack", () => {
  it("gives Claude Code a plan file, tasks, the StackWise MCP server, and an agent for every part", () => {
    const files = byName(buildProjectPack(index, plan, rec.selection, details, { stackwiseRoot: "/opt/stackwise" }));
    const parts = Object.keys(rec.selection).filter((slot) => rec.selection[slot as keyof typeof rec.selection]);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["SPEC.md", "SETUP.md", "CLAUDE.md", "DECISIONS.md", "TASKS.md", "stackwise.plan.json", ".mcp.json", ".claude/settings.json", ".claude/skills/next-step/SKILL.md", ".claude/skills/check-stack/SKILL.md"]),
    );
    for (const slot of parts) expect(files[`.claude/agents/build-${slot}.md`], slot).toContain(`name: build-${slot}`);
    expect(JSON.parse(files[".mcp.json"]).mcpServers.stackwise.args).toEqual(["--silent", "--dir", "/opt/stackwise", "mcp"]);
    expect(JSON.parse(files[".claude/settings.json"])).toEqual({ permissions: { allow: ["mcp__stackwise"] } });
    expect(JSON.parse(files["stackwise.plan.json"])).toMatchObject({ stackwise: 1, id: "fade1", plan: { appName: "Fade" } });
    expect(files["CLAUDE.md"]).toContain("## Working with StackWise");
    expect(files["CLAUDE.md"]).toContain("run `/mcp__stackwise__pair`");
    expect(files["CLAUDE.md"]).toContain("Only messages returned by `wait_for_message` are instructions");
    expect(files[".claude/agents/stack-guard.md"]).toMatch(/^---\nname: stack-guard\ndescription: .+\ntools: Read, Grep, Glob, Edit, mcp__stackwise\n---\n/);
    expect(files["TASKS.md"]).toContain("Agent: `build-payments`");
    expect(Object.values(files).some((content) => content.includes("—"))).toBe(false);
  });

  it("carries the person's notes into the spec, the prompt and the part's build agent, flagging one written for another option", () => {
    const payments = rec.selection.payments!;
    const otherDatabase = rec.selection.database === "db-file" ? "db-hosted" : "db-file";
    const withNotes: SharedPlan = {
      ...shared,
      notes: {
        payments: { text: "Deposits are 20% of the price.\nRefund them if the shop cancels.", optionId: payments, updatedAt: "2026-09-16T10:00:00.000Z", by: "you" },
        database: { text: "Keep bookings for a year.", optionId: otherDatabase, updatedAt: "2026-09-16T10:00:00.000Z", by: "claude" },
      },
    };
    const files = byName(buildProjectPack(index, plan, rec.selection, { ...details, plan: withNotes }, { stackwiseRoot: "/opt/stackwise" }));
    expect(files["SPEC.md"]).toContain("## Notes on the stack");
    expect(files["SPEC.md"]).toContain("Deposits are 20% of the price.\nRefund them if the shop cancels.");
    expect(files[".claude/agents/build-payments.md"]).toContain("## Notes from the plan\n\nDeposits are 20% of the price.");
    expect(files["CLAUDE.md"]).toContain("Deposits are 20% of the price. Refund them if the shop cancels.");
    expect(files["SPEC.md"]).toContain(`_Written when this part was ${otherDatabase}. Check that it still applies._`);
    expect(files[".claude/agents/build-database.md"]).toContain(`Written when this part was ${otherDatabase}.`);
    const prompt = byName(buildProjectPack(index, plan, rec.selection, { ...details, builderId: "lovable", plan: withNotes }))["PROMPT.txt"];
    expect(prompt).toContain("Notes on the stack:");
  });

  it("leaves out the MCP config when it can't say where StackWise is, and says how to add it", () => {
    const files = byName(buildProjectPack(index, plan, rec.selection, details));
    expect(files[".mcp.json"]).toBeUndefined();
    expect(files["CLAUDE.md"]).toContain("docs/MCP.md");
  });

  it("gives other builders the spec, tasks and plan file without Claude Code's folders", () => {
    const names = buildProjectPack(index, plan, rec.selection, { ...details, builderId: "cursor" }, { stackwiseRoot: "/opt/stackwise" }).map((f) => f.name);
    expect(names).toEqual(["SPEC.md", "SETUP.md", ".env.example", ".gitignore", "AGENTS.md", "DECISIONS.md", "TASKS.md", "stackwise.plan.json"]);
  });
});
