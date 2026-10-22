import { KNOWN_AGENTS } from "@/mcp/pairing";

/**
 * Coding agents installed on this computer, for the Agents section of Settings. Pure helpers: the
 * route runs the commands, these say which command each agent has and read what it printed.
 */

/** The command each known agent installs, when it has one. */
export const AGENT_COMMANDS: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  "gemini-cli": "gemini",
  cursor: "cursor-agent",
  "copilot-cli": "copilot",
  opencode: "opencode",
  amp: "amp",
  goose: "goose",
  "qwen-code": "qwen",
};

/** Where to get each agent, for the ones that aren't installed. */
export const AGENT_SITES: Record<string, string> = {
  "claude-code": "https://claude.com/claude-code",
  codex: "https://github.com/openai/codex",
  "gemini-cli": "https://github.com/google-gemini/gemini-cli",
  cursor: "https://cursor.com/cli",
  "copilot-cli": "https://github.com/github/copilot-cli",
  opencode: "https://opencode.ai",
  amp: "https://ampcode.com",
  goose: "https://block.github.io/goose/",
  "qwen-code": "https://github.com/QwenLM/qwen-code",
};

export interface AgentInfo {
  id: string;
  name: string;
  maker: string;
  command: string;
  installed: boolean;
  /** Where the command is, when it's installed. */
  path?: string;
  version?: string;
  site: string;
  /** For Claude Code: whether it has StackWise as an MCP server, and at which address. */
  mcp?: { connected: boolean; url: string | null };
}

export const MCP_URL = "http://127.0.0.1:4310/api/mcp";

/** The version number out of whatever `--version` printed ("2.1.269 (Claude Code)" gives "2.1.269"). */
export function parseVersion(output: string): string | null {
  const match = /\b(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?)\b/.exec(output);
  return match ? match[1] : null;
}

/**
 * Whether Claude Code has StackWise as an MCP server, read from its own config (~/.claude.json)
 * rather than by asking `claude mcp get`, which checks the server's health by calling it: from
 * inside that server, the call would wait on itself.
 */
export function readClaudeMcp(configText: string | null): { connected: boolean; url: string | null } {
  if (!configText) return { connected: false, url: null };
  try {
    const config = JSON.parse(configText) as { mcpServers?: Record<string, { url?: unknown }> };
    const url = config.mcpServers?.stackwise?.url;
    return typeof url === "string" ? { connected: url === MCP_URL, url } : { connected: false, url: null };
  } catch {
    return { connected: false, url: null };
  }
}

/** The list the Settings page shows: every known agent, installed or not, Claude Code first. */
export function describeAgents(found: Record<string, { path: string; version: string | null } | null>, claudeConfig: string | null): AgentInfo[] {
  return KNOWN_AGENTS.map((agent) => {
    const command = AGENT_COMMANDS[agent.id];
    const hit = found[agent.id];
    return {
      id: agent.id,
      name: agent.name,
      maker: agent.maker,
      command,
      installed: Boolean(hit),
      ...(hit ? { path: hit.path, ...(hit.version ? { version: hit.version } : {}) } : {}),
      site: AGENT_SITES[agent.id],
      ...(agent.id === "claude-code" && hit ? { mcp: readClaudeMcp(claudeConfig) } : {}),
    };
  });
}
