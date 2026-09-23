import Anthropic from "@anthropic-ai/sdk";

/**
 * Node-only. AI is optional everywhere in StackWise: with no key configured, the planner uses
 * keyword guesses and a template summary, and nothing else changes.
 */

export const AI_MODEL = process.env.WHYSTACK_MODEL || "claude-opus-5";
export const AI_EFFORT = (process.env.WHYSTACK_EFFORT as "low" | "medium" | "high" | undefined) || "low";

/** Server-side refusal fallback: routes a declined request to Anthropic's recommended model. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function aiEnabled(): boolean {
  if (process.env.WHYSTACK_AI === "off") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  client ??= new Anthropic({ timeout: 60_000, maxRetries: 2 });
  return client;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly reason: "refused" | "bad_output" | "rate_limited" | "auth" | "unavailable",
  ) {
    super(message);
  }
}

/** A short, human reason for falling back, safe to show in the UI. */
export function describeAiError(error: unknown): string {
  if (error instanceof AiError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return "The Claude API key was rejected, so keywords were used instead.";
  if (error instanceof Anthropic.RateLimitError) return "Claude is rate limited right now, so keywords were used instead.";
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude, so keywords were used instead.";
  if (error instanceof Anthropic.APIError) return `Claude returned an error (${error.status}), so keywords were used instead.`;
  return "The AI step failed, so keywords were used instead.";
}

/** Michael's writing rule, enforced on anything a model writes before it reaches the page. */
export function withoutEmDashes(text: string): string {
  return text.replace(/\s*\u2014\s*/g, ", ");
}
