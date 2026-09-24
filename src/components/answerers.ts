import { agentName, KNOWN_AGENTS, presence, type Presence } from "@/mcp/pairing";
import type { AiStatus, ProviderInfo } from "./Planner";
import type { Pairing } from "./usePairing";

/**
 * Who can answer in StackWise: a coding agent in a terminal, a built-in AI with a key, or
 * StackWise's own facts. The Connect screen, the connection pill in the top bar and the Ask panel
 * all read this list, so they always agree on what's connected.
 */

/** "agent:<id>", "api:claude", "api:openai", "api:gemini" or "facts". */
export type RecipientId = string;

export interface Recipient {
  id: RecipientId;
  label: string;
  group: "agent" | "api" | "facts";
  /** listening, working, connected or stopped for agents; ready or needs-key for the rest. */
  state: Presence | "not-connected" | "ready" | "needs-key";
  /** For a built-in AI without a key: the variable to add to .env.local. */
  keyName?: string;
}

export const DEFAULT_ANSWERER_KEY = "stackwise.answerer";

export const STATE_TEXT: Record<Recipient["state"], string> = {
  listening: "Listening",
  working: "Working",
  connected: "Idle",
  stopped: "Stopped listening",
  "not-connected": "Not connected",
  ready: "Ready",
  "needs-key": "Needs a key",
};

/** The name to show for a built-in AI's answer. */
export function providerLabel(ai: AiStatus | null, id: string | undefined): string {
  return providersOf(ai).find((p) => p.id === (id ?? "claude"))?.label ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : "Claude");
}

/** The built-in AIs the server reported, or Claude alone for an older server. */
export function providersOf(ai: AiStatus | null): ProviderInfo[] {
  if (ai?.providers?.length) return ai.providers;
  return [{ id: "claude", label: "Claude", on: Boolean(ai?.ai), model: ai?.model ?? "", keyName: "ANTHROPIC_API_KEY", featured: true }];
}

/** The built-in AI that reads a description (see /api/prefill): the saved default when it has a key, else the first with one. */
export function descriptionReader(ai: AiStatus | null, saved: string | null): ProviderInfo | null {
  const on = providersOf(ai).filter((p) => p.on);
  const wanted = saved?.startsWith("api:") ? saved.slice("api:".length) : undefined;
  return on.find((p) => p.id === wanted) ?? on[0] ?? null;
}

export function recipientsFor(ai: AiStatus | null, pairing: Pick<Pairing, "agents" | "serverNow">): Recipient[] {
  const seen = Object.values(pairing.agents);
  const agentIds = [...KNOWN_AGENTS.map((a) => a.id as string), ...seen.map((a) => a.id)].filter((id, i, all) => all.indexOf(id) === i);
  return [
    ...agentIds.map((id): Recipient => {
      const state = pairing.agents[id];
      return { id: `agent:${id}`, label: agentName(id), group: "agent", state: state ? presence(state, pairing.serverNow) : "not-connected" };
    }),
    ...providersOf(ai)
      // Claude, OpenAI, Gemini and DeepSeek are always listed; any other model once it's set up in .env.local.
      .filter((p) => p.featured !== false || p.on)
      .map((p): Recipient => ({ id: `api:${p.id}`, label: p.on ? `${p.label} API (${p.model})` : `${p.label} API`, group: "api", state: p.on ? "ready" : "needs-key", keyName: p.keyName })),
    { id: "facts", label: "StackWise facts", group: "facts", state: "ready" },
  ];
}

/** Whether a recipient can answer right now (an agent that isn't listening still gets its messages later). */
export const usable = (r: Recipient | undefined) => Boolean(r && r.state !== "needs-key");
/** Whether an AI is actually connected: an agent listening or working, or a built-in AI with a key. StackWise's facts alone don't count. */
export const live = (r: Recipient | undefined) => Boolean(r && (r.state === "listening" || r.state === "working" || (r.group === "api" && r.state === "ready")));

/** Claude by default: Claude Code when it's listening, then a built-in AI with a key (Claude first), then StackWise's facts. A saved default wins when it can answer. */
export function pickDefault(list: Recipient[], saved: string | null): RecipientId {
  const byId = (id: string) => list.find((r) => r.id === id);
  if (saved && usable(byId(saved))) return saved;
  const claudeCode = byId("agent:claude-code");
  if (claudeCode && (claudeCode.state === "listening" || claudeCode.state === "working")) return claudeCode.id;
  const api = list.find((r) => r.group === "api" && usable(r));
  if (api) return api.id;
  return "facts";
}

export function readDefaultAnswerer(): string | null {
  try {
    return window.localStorage.getItem(DEFAULT_ANSWERER_KEY);
  } catch {
    return null;
  }
}

export function saveDefaultAnswerer(id: RecipientId): void {
  try {
    window.localStorage.setItem(DEFAULT_ANSWERER_KEY, id);
  } catch {
    // Private windows: the default lasts until the tab closes.
  }
}

/**
 * Each answerer's mark: full-color brand marks where the brand has one, and one-color marks
 * (`mono`) that the page tints to the text color so they read in light and dark. Most come from
 * LobeHub's icon set (MIT), saved in public/brand/ai.
 */
export interface AnswererMark {
  src: string;
  mono?: boolean;
}

const ANSWERER_LOGOS: Record<string, AnswererMark> = {
  "agent:claude-code": { src: "/brand/claude.svg" },
  "agent:codex": { src: "/brand/ai/codex.svg" },
  "agent:gemini-cli": { src: "/brand/ai/gemini.svg" },
  "agent:cursor": { src: "/brand/ai/cursor.svg", mono: true },
  "agent:copilot-cli": { src: "/brand/ai/copilot.svg", mono: true },
  "agent:opencode": { src: "/brand/ai/opencode.svg", mono: true },
  "agent:amp": { src: "/brand/ai/amp.svg", mono: true },
  "agent:goose": { src: "/brand/ai/goose.svg", mono: true },
  "agent:qwen-code": { src: "/brand/ai/qwen.svg" },
  "api:claude": { src: "/brand/claude.svg" },
  "api:openai": { src: "/brand/ai/openai.svg", mono: true },
  "api:gemini": { src: "/brand/ai/gemini.svg" },
  "api:deepseek": { src: "/brand/ai/deepseek.svg" },
  "api:openrouter": { src: "/logos/openrouter.svg" },
  "api:groq": { src: "/logos/groq.png" },
  "api:mistral": { src: "/logos/mistral.svg" },
  "api:ollama": { src: "/brand/ollama.svg" },
  facts: { src: "/icon.svg" },
};

/** An agent that joined under a longer name ("claude-code-2") keeps its family's mark. */
export function answererLogo(id: RecipientId): AnswererMark | null {
  if (ANSWERER_LOGOS[id]) return ANSWERER_LOGOS[id];
  const family = Object.keys(ANSWERER_LOGOS).find((key) => key.startsWith("agent:") && id.startsWith(key));
  return family ? ANSWERER_LOGOS[family] : null;
}
