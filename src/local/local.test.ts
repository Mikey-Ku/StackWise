import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeAgents, parseVersion, readClaudeMcp, readClaudeModel, withClaudeModel } from "./agents";
import { DEFAULT_PROFILE, migrateRepoState, readLibraryIndex, readProfile, stackwiseHome, writeLibraryIndex, writeProfile } from "./home";
import { scanFolder, type ScanFs } from "./scan";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "stackwise-home-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the home folder", () => {
  it("is ~/.stackwise unless STACKWISE_HOME says otherwise", () => {
    expect(stackwiseHome({}, "/Users/sam")).toBe("/Users/sam/.stackwise");
    expect(stackwiseHome({ STACKWISE_HOME: "/tmp/sw" }, "/Users/sam")).toBe("/tmp/sw");
  });

  it("starts with a default profile, keeps what's written, and ignores bad or unknown fields", () => {
    expect(readProfile(dir)).toEqual(DEFAULT_PROFILE);
    const saved = writeProfile(dir, { name: "Sam", priority: "learn", folders: ["~/code"] });
    expect(saved).toMatchObject({ name: "Sam", priority: "learn", folders: ["~/code"], builderId: "claude-code" });
    expect(readProfile(dir)).toEqual(saved);
    expect(() => writeProfile(dir, { priority: "fastest" as never })).toThrow();
    expect(readProfile(dir).priority).toBe("learn");
    expect((fs.statSync(path.join(dir, "profile.json")).mode & 0o777).toString(8)).toBe("600");
  });

  it("remembers which plan is open and the order, and reads nothing as an empty library", () => {
    expect(readLibraryIndex(dir)).toEqual({ activeId: null, order: [] });
    writeLibraryIndex(dir, { activeId: "a1", order: ["a1", "b2"] });
    expect(readLibraryIndex(dir)).toEqual({ activeId: "a1", order: ["a1", "b2"] });
  });

  it("moves shared plans out of StackWise's own folder once, without deleting anything", () => {
    const repo = path.join(dir, "repo");
    const home = path.join(dir, "home");
    fs.mkdirSync(path.join(repo, ".stackwise", "plans"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".stackwise", "plans", "p1.json"), "{}");
    fs.writeFileSync(path.join(repo, ".stackwise", "active.json"), '{"id":"p1"}');
    expect(migrateRepoState(repo, home)).toEqual(["p1"]);
    expect(fs.existsSync(path.join(home, "plans", "p1.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, "active.json"))).toBe(true);
    expect(fs.existsSync(path.join(repo, ".stackwise", "plans.moved", "p1.json"))).toBe(true);
    expect(migrateRepoState(repo, home)).toEqual([]);
    expect(migrateRepoState(home, home)).toEqual([]);
  });
});

describe("finding projects", () => {
  const files: Record<string, string> = {
    "/home/Projects/shop/package.json": JSON.stringify({ dependencies: { next: "16" }, scripts: { dev: "next dev" } }),
    "/home/Projects/shop/stackwise.plan.json": JSON.stringify({ stackwise: 1, id: "shop1", version: 2, updatedAt: "2026-01-01", plan: { appName: "Shop" } }),
    "/home/Projects/api/pom.xml": "<project><artifactId>spring-boot-starter-web</artifactId></project>",
    "/home/Projects/notes/README.md": "Just notes.",
    "/home/Projects/broken/stackwise.plan.json": "{not json",
    "/home/Projects/broken/package.json": "{}",
  };
  const fsx: ScanFs = {
    folders: (d) => (d === "/home/Projects" ? ["shop", "api", "notes", "node_modules", ".git", "broken"] : []),
    exists: (f) => f in files,
    read: (f) => files[f] ?? null,
  };

  it("lists folders with a plan file or a recognizable app, skips the rest, and reads each plan's name", () => {
    const found = scanFolder(fsx, "/home/Projects");
    expect(found.map((p) => p.name)).toEqual(["api", "broken", "shop"]);
    expect(found.find((p) => p.name === "shop")).toMatchObject({ framework: "nextjs", plan: { id: "shop1", appName: "Shop" } });
    expect(found.find((p) => p.name === "api")).toMatchObject({ label: expect.stringContaining("Spring"), plan: null });
    // A broken plan file doesn't count as a plan, but the folder still shows.
    expect(found.find((p) => p.name === "broken")?.plan).toBeNull();
  });
});

describe("installed agents", () => {
  it("reads a version out of what the command printed", () => {
    expect(parseVersion("2.1.269 (Claude Code)")).toBe("2.1.269");
    expect(parseVersion("codex-cli 0.44.0")).toBe("0.44.0");
    expect(parseVersion("no digits here")).toBeNull();
  });

  it("reads whether Claude Code points at StackWise, and at the right address, from its config", () => {
    expect(readClaudeMcp(null)).toEqual({ connected: false, url: null });
    expect(readClaudeMcp("{not json")).toEqual({ connected: false, url: null });
    expect(readClaudeMcp(JSON.stringify({ mcpServers: { stackwise: { type: "http", url: "http://127.0.0.1:4310/api/mcp" } } }))).toEqual({ connected: true, url: "http://127.0.0.1:4310/api/mcp" });
    // Set up before the move to 127.0.0.1: listed, but not connected.
    expect(readClaudeMcp(JSON.stringify({ mcpServers: { stackwise: { url: "http://localhost:4310/api/mcp" } } }))).toEqual({ connected: false, url: "http://localhost:4310/api/mcp" });
    expect(readClaudeMcp(JSON.stringify({ mcpServers: {} }))).toEqual({ connected: false, url: null });
  });

  it("reads and sets the model Claude Code starts new sessions with, keeping the rest of its settings", () => {
    expect(readClaudeModel(null)).toBeNull();
    expect(readClaudeModel('{"model":"opus[1m]","permissions":{}}')).toBe("opus[1m]");
    const next = withClaudeModel('{"permissions":{"allow":["Bash"]},"model":"opus"}', "claude-opus-5-5")!;
    expect(JSON.parse(next)).toEqual({ permissions: { allow: ["Bash"] }, model: "claude-opus-5-5" });
    expect(JSON.parse(withClaudeModel(next, "")!)).toEqual({ permissions: { allow: ["Bash"] } });
    expect(JSON.parse(withClaudeModel(null, "claude-sonnet-5-5")!)).toEqual({ model: "claude-sonnet-5-5" });
    expect(withClaudeModel("{not json", "x")).toBeNull();
    expect(withClaudeModel("[1,2]", "x")).toBeNull();
  });

  it("lists every known agent, installed or not, with Claude Code's MCP state", () => {
    const list = describeAgents({ "claude-code": { path: "/usr/local/bin/claude", version: "2.1.269" } }, JSON.stringify({ mcpServers: { stackwise: { url: "http://127.0.0.1:4310/api/mcp" } } }));
    expect(list[0]).toMatchObject({ id: "claude-code", installed: true, version: "2.1.269", command: "claude", mcp: { connected: true } });
    expect(list.find((a) => a.id === "codex")).toMatchObject({ installed: false, site: expect.stringContaining("http") });
    expect(list.find((a) => a.id === "codex")?.mcp).toBeUndefined();
  });
});
