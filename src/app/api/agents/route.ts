import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { AGENT_COMMANDS, describeAgents, MCP_URL, parseVersion, withClaudeModel, type AgentInfo } from "@/local/agents";
import { localOnly, readJson } from "@/mcp/local";

/**
 * Which coding agents are installed on this computer, for Settings. GET looks each one up and
 * reads its version; POST connects Claude Code to StackWise (`claude mcp add`), disconnects it, or
 * sets the model its new sessions start with (the "model" key of ~/.claude/settings.json, nothing
 * else in that file touched). Only the commands in AGENT_COMMANDS are ever run, with fixed
 * arguments, and never in a way that blocks the server: `claude mcp add` checks the server's
 * health by calling it.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const exec = promisify(execFile);
const CACHE_MS = 20_000;
let cache: { at: number; list: AgentInfo[] } | null = null;

/** The server's PATH plus the folders where people's command-line tools usually land. */
function userPath(): string {
  const home = os.homedir();
  const extra = [path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".npm-global", "bin"), path.join(home, "Library", "pnpm"), path.join(home, ".bun", "bin"), path.join(home, ".cargo", "bin")];
  return [...(process.env.PATH ?? "").split(path.delimiter), ...extra].filter((p, i, all) => p && all.indexOf(p) === i).join(path.delimiter);
}

async function run(command: string, args: string[], timeout = 8000): Promise<string | null> {
  try {
    const { stdout, stderr } = await exec(command, args, { encoding: "utf8", timeout, env: { ...process.env, PATH: userPath() } });
    return `${stdout}${stderr}`;
  } catch {
    return null;
  }
}

function claudeConfig(): string | null {
  try {
    return fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8");
  } catch {
    return null;
  }
}
const claudeSettingsPath = () => path.join(os.homedir(), ".claude", "settings.json");
function claudeSettings(): string | null {
  try {
    return fs.readFileSync(claudeSettingsPath(), "utf8");
  } catch {
    return null;
  }
}

async function lookUp(): Promise<AgentInfo[]> {
  const found: Record<string, { path: string; version: string | null } | null> = {};
  await Promise.all(
    Object.entries(AGENT_COMMANDS).map(async ([id, command]) => {
      const where = (await run("which", [command]))?.trim().split("\n")[0];
      found[id] = where ? { path: where, version: parseVersion((await run(command, ["--version"])) ?? "") } : null;
    }),
  );
  return describeAgents(found, claudeConfig(), claudeSettings());
}

async function list(fresh = false): Promise<AgentInfo[]> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.list;
  const found = await lookUp();
  cache = { at: Date.now(), list: found };
  return found;
}

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  return Response.json({ agents: await list(new URL(request.url).searchParams.has("fresh")), mcpUrl: MCP_URL });
}

const postSchema = z.object({
  action: z.enum(["connect", "disconnect", "model"]),
  agent: z.literal("claude-code"),
  /** For "model": a model id or alias; empty puts Claude Code back on its own default. */
  model: z
    .string()
    .max(120)
    .regex(/^[A-Za-z0-9._:/[\]-]*$/)
    .optional(),
});

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = postSchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "Only Claude Code can be connected or set from here. Other agents take the address by hand." }, { status: 400 });
  if (parsed.data.action === "model") {
    const next = withClaudeModel(claudeSettings(), parsed.data.model ?? "");
    if (next === null) return Response.json({ error: "Claude Code's settings.json isn't JSON StackWise can edit. Set the model in Claude Code itself." }, { status: 400 });
    try {
      const file = claudeSettingsPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, next);
      fs.renameSync(tmp, file);
    } catch {
      return Response.json({ error: "Couldn't write Claude Code's settings.json." }, { status: 500 });
    }
    return Response.json({ agents: await list(true), mcpUrl: MCP_URL });
  }
  // Replace whatever address it has: one set up at localhost won't work on macOS.
  await run("claude", ["mcp", "remove", "--scope", "user", "stackwise"], 30_000);
  if (parsed.data.action === "connect") {
    const ok = (await run("claude", ["mcp", "add", "--transport", "http", "--scope", "user", "stackwise", MCP_URL], 30_000)) !== null;
    if (!ok) return Response.json({ error: `Claude Code didn't take it. Run this yourself: claude mcp add --transport http --scope user stackwise ${MCP_URL}` }, { status: 500 });
  }
  return Response.json({ agents: await list(true), mcpUrl: MCP_URL });
}
