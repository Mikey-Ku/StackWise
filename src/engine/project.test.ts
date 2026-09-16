import { describe, expect, it } from "vitest";
import { buildProjectPack } from "./project";
import { recommend } from "./score";
import type { SharedPlan } from "./share";
import { fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();
const plan = input({ saves_data: "yes", login: "yes", users_pay: "yes" });
const rec = recommend(index, plan);
const shared: SharedPlan = { v: 1, appName: "Fade", description: "Bookings for a barber shop.", features: "", answers: plan.answers, size: plan.size, priority: plan.priority, builderId: "claude-code", pinned: {} };
const details = { appName: "Fade", description: shared.description, features: "", builderId: "claude-code", generatedOn: "2026-09-15", planId: "fade1", plan: shared };
const byName = (files: { name: string; content: string }[]) => Object.fromEntries(files.map((f) => [f.name, f.content]));

describe("project pack", () => {
  it("gives Claude Code a plan file, tasks, the WhyStack MCP server, and an agent for every part", () => {
    const files = byName(buildProjectPack(index, plan, rec.selection, details, { whystackRoot: "/opt/whystack" }));
    const parts = Object.keys(rec.selection).filter((slot) => rec.selection[slot as keyof typeof rec.selection]);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["SPEC.md", "SETUP.md", "CLAUDE.md", "DECISIONS.md", "TASKS.md", "whystack.plan.json", ".mcp.json", ".claude/settings.json", ".claude/skills/next-step/SKILL.md", ".claude/skills/check-stack/SKILL.md"]),
    );
    for (const slot of parts) expect(files[`.claude/agents/build-${slot}.md`], slot).toContain(`name: build-${slot}`);
    expect(JSON.parse(files[".mcp.json"]).mcpServers.whystack.args).toEqual(["--silent", "--dir", "/opt/whystack", "mcp"]);
    expect(JSON.parse(files[".claude/settings.json"])).toEqual({ permissions: { allow: ["mcp__whystack"] } });
    expect(JSON.parse(files["whystack.plan.json"])).toMatchObject({ whystack: 1, id: "fade1", plan: { appName: "Fade" } });
    expect(files["CLAUDE.md"]).toContain("## Working with WhyStack");
    expect(files[".claude/agents/stack-guard.md"]).toMatch(/^---\nname: stack-guard\ndescription: .+\ntools: Read, Grep, Glob, Edit, mcp__whystack\n---\n/);
    expect(files["TASKS.md"]).toContain("Agent: `build-payments`");
    expect(Object.values(files).some((content) => content.includes("—"))).toBe(false);
  });

  it("leaves out the MCP config when it can't say where WhyStack is, and says how to add it", () => {
    const files = byName(buildProjectPack(index, plan, rec.selection, details));
    expect(files[".mcp.json"]).toBeUndefined();
    expect(files["CLAUDE.md"]).toContain("docs/MCP.md");
  });

  it("gives other builders the spec, tasks and plan file without Claude Code's folders", () => {
    const names = buildProjectPack(index, plan, rec.selection, { ...details, builderId: "cursor" }, { whystackRoot: "/opt/whystack" }).map((f) => f.name);
    expect(names).toEqual(["SPEC.md", "SETUP.md", ".env.example", ".gitignore", "AGENTS.md", "DECISIONS.md", "TASKS.md", "whystack.plan.json"]);
  });
});
