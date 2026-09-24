import { z } from "zod";
import { AI_MODEL, AiError, aiEnabled } from "./config";
import { setting } from "@/engine/names";

/**
 * Node-only. The built-in AI can be any model in PROVIDERS that has what it needs in .env.local.
 * Claude stays the default (see config.ts) and keeps its own path with structured outputs and the
 * server-side fallback. Everything else is called over REST with the same prompts: asked for JSON
 * that matches the same Zod schema, and checked against it here, so a model that drifts from the
 * format falls back to StackWise's facts like any failure. Whatever a model says, the rules still
 * decide verdicts, prices and limits.
 *
 * Adding a model is one entry below. Most providers speak OpenAI's chat format ("openai-chat"),
 * so an entry is a base URL and the names of its key and model variables. Presets without a
 * default model only turn on once their model variable is set, so StackWise never guesses a name.
 */

export type ProviderKind = "anthropic" | "openai-chat" | "gemini";

export interface ProviderDef {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Env names that hold the key, first one wins. Empty for a local server that needs none. */
  keyEnv: string[];
  /** Env name for the model, and the model used when it's unset (none: the preset stays off until it's set). */
  modelEnv: string;
  defaultModel?: string;
  /** For "openai-chat": where the API lives, or the env name that says so. */
  baseUrl?: string;
  baseUrlEnv?: string;
  /** Env name for a display name, for the custom endpoint. */
  labelEnv?: string;
}

export const PROVIDERS: ProviderDef[] = [
  { id: "claude", label: "Claude", kind: "anthropic", keyEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"], modelEnv: "STACKWISE_MODEL", defaultModel: AI_MODEL },
  { id: "openai", label: "OpenAI", kind: "openai-chat", keyEnv: ["OPENAI_API_KEY"], modelEnv: "OPENAI_MODEL", defaultModel: "gpt-6-luna", baseUrl: "https://api.openai.com/v1" },
  { id: "gemini", label: "Gemini", kind: "gemini", keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], modelEnv: "GEMINI_MODEL", defaultModel: "gemini-3.8-flash" },
  { id: "deepseek", label: "DeepSeek", kind: "openai-chat", keyEnv: ["DEEPSEEK_API_KEY"], modelEnv: "DEEPSEEK_MODEL", defaultModel: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
  { id: "openrouter", label: "OpenRouter", kind: "openai-chat", keyEnv: ["OPENROUTER_API_KEY"], modelEnv: "OPENROUTER_MODEL", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "groq", label: "Groq", kind: "openai-chat", keyEnv: ["GROQ_API_KEY"], modelEnv: "GROQ_MODEL", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "mistral", label: "Mistral", kind: "openai-chat", keyEnv: ["MISTRAL_API_KEY"], modelEnv: "MISTRAL_MODEL", baseUrl: "https://api.mistral.ai/v1" },
  { id: "ollama", label: "Ollama (on this computer)", kind: "openai-chat", keyEnv: [], modelEnv: "OLLAMA_MODEL", baseUrl: "http://localhost:11434/v1", baseUrlEnv: "OLLAMA_BASE_URL" },
  { id: "custom", label: "Custom model", kind: "openai-chat", keyEnv: ["CUSTOM_AI_API_KEY"], modelEnv: "CUSTOM_AI_MODEL", baseUrlEnv: "CUSTOM_AI_BASE_URL", labelEnv: "CUSTOM_AI_LABEL" },
];

/** Always offered on the Connect screen, where a key can be pasted in; the rest show once they're set up. */
export const FEATURED_PROVIDERS = ["claude", "openai", "gemini", "deepseek"];

/** The only variables the Connect screen may write to StackWise's own .env.local: each provider's first key name. */
export const PROVIDER_KEY_NAMES = new Set(PROVIDERS.flatMap((p) => p.keyEnv.slice(0, 1)));

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);
export type ProviderId = string;

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  on: boolean;
  model: string;
  /** The variable to set in .env.local. Never the value. */
  keyName: string;
  /** Everything it still needs before it can turn on, by name. */
  needs: string[];
  /** Where OpenAI-style requests go. Never includes a key. */
  baseUrl?: string;
  /** Always offered in the menus (Claude, OpenAI, Gemini, DeepSeek); the rest show once they're set up. */
  featured: boolean;
}

type Env = Record<string, string | undefined>;

export function providerStatus(env: Env = process.env): ProviderStatus[] {
  const off = setting("AI", env) === "off";
  return PROVIDERS.map((def) => {
    const model = env[def.modelEnv] || def.defaultModel || "";
    const baseUrl = (def.baseUrlEnv && env[def.baseUrlEnv]) || def.baseUrl;
    const needs = [
      ...(def.keyEnv.length && !def.keyEnv.some((k) => env[k]) ? [def.keyEnv[0]] : []),
      ...(model ? [] : [def.modelEnv]),
      ...(def.kind === "openai-chat" && !baseUrl && def.baseUrlEnv ? [def.baseUrlEnv] : []),
    ];
    const on = def.id === "claude" ? aiEnabled() : !off && needs.length === 0;
    return {
      id: def.id,
      label: (def.labelEnv && env[def.labelEnv]) || def.label,
      kind: def.kind,
      on,
      model,
      keyName: def.keyEnv[0] ?? def.modelEnv,
      needs,
      ...(baseUrl ? { baseUrl } : {}),
      featured: FEATURED_PROVIDERS.includes(def.id),
    };
  });
}

function keyFor(status: ProviderStatus, env: Env): string {
  const def = PROVIDERS.find((p) => p.id === status.id);
  return def?.keyEnv.map((k) => env[k]).find(Boolean) ?? "";
}

/** The provider asked for, if it has a key. With none asked for, the first with a key, Claude first. */
export function chooseProvider(requested: ProviderId | undefined, env: Env = process.env): ProviderStatus | null {
  const list = providerStatus(env);
  if (requested) return list.find((p) => p.id === requested && p.on) ?? null;
  return list.find((p) => p.on) ?? null;
}

export interface AskOptions {
  system: string;
  user: string;
  maxTokens?: number;
}

/** Just enough of fetch to stand in for it in tests. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const TIMEOUT_MS = 60_000;

/** A JSON Schema for the model, without the keys some APIs refuse. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

function httpError(label: string, status: number): AiError {
  if (status === 401 || status === 403) return new AiError(`The ${label} API key was rejected, so keywords were used instead.`, "auth");
  if (status === 429) return new AiError(`${label} is rate limited right now, so keywords were used instead.`, "rate_limited");
  return new AiError(`${label} returned an error (${status}), so keywords were used instead.`, "unavailable");
}

function parseJson<T>(label: string, text: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    // Some models wrap JSON in a code fence even when asked not to.
    raw = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    throw new AiError(`${label}'s answer couldn't be read, so keywords were used instead.`, "bad_output");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AiError(`${label}'s answer wasn't in the expected shape, so keywords were used instead.`, "bad_output");
  return parsed.data;
}

async function post(label: string, fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown) {
  let response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AiError(`Couldn't reach ${label}, so keywords were used instead.`, "unavailable");
  }
  if (!response.ok) throw httpError(label, response.status);
  return (await response.json()) as Record<string, unknown>;
}

interface OpenAiChat {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
}

/** Any API that speaks OpenAI's chat format: OpenAI itself, OpenRouter, Groq, Mistral, Ollama, or a custom endpoint. */
async function openai(status: ProviderStatus, options: AskOptions, format: unknown, env: Env, fetchImpl: FetchLike): Promise<string> {
  const key = keyFor(status, env);
  const url = `${(status.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  const data = (await post(status.label, fetchImpl, url, key ? { authorization: `Bearer ${key}` } : {}, {
    model: status.model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    max_completion_tokens: options.maxTokens ?? 8000,
    ...(format ? { response_format: format } : {}),
  })) as OpenAiChat;
  const message = data.choices?.[0]?.message;
  if (message?.refusal) throw new AiError(`${status.label} declined to answer that, so StackWise answered from its facts.`, "refused");
  const text = message?.content?.trim();
  if (!text) throw new AiError(`${status.label} returned an empty answer, so keywords were used instead.`, "bad_output");
  return text;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

const GEMINI_BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

async function gemini(status: ProviderStatus, options: AskOptions, schema: Record<string, unknown> | null, env: Env, fetchImpl: FetchLike): Promise<string> {
  const key = keyFor(status, env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(status.model)}:generateContent`;
  const data = (await post("Gemini", fetchImpl, url, { "x-goog-api-key": key }, {
    systemInstruction: { parts: [{ text: options.system }] },
    contents: [{ role: "user", parts: [{ text: options.user }] }],
    generationConfig: { maxOutputTokens: options.maxTokens ?? 8000, ...(schema ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}) },
  })) as GeminiResponse;
  const candidate = data.candidates?.[0];
  if (data.promptFeedback?.blockReason || (candidate?.finishReason && GEMINI_BLOCKED.has(candidate.finishReason))) {
    throw new AiError("Gemini declined to answer that, so StackWise answered from its facts.", "refused");
  }
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AiError("Gemini returned an empty answer, so keywords were used instead.", "bad_output");
  return text;
}

/** Ask OpenAI or Gemini for JSON matching a schema. */
export async function askJson<T>(status: ProviderStatus, options: AskOptions & { schema: z.ZodType<T>; name: string }, env: Env = process.env, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<T> {
  const schema = jsonSchemaFor(options.schema);
  // The shape goes in the prompt too, so a model that ignores the format setting still knows it.
  const user = `${options.user}\n\nAnswer with only a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`;
  const text =
    status.kind === "openai-chat"
      ? await openai(status, { ...options, user }, status.id === "openai" ? { type: "json_schema", json_schema: { name: options.name, schema, strict: false } } : { type: "json_object" }, env, fetchImpl)
      : status.kind === "gemini"
        ? await gemini(status, { ...options, user }, schema, env, fetchImpl)
        : unsupported(status);
  return parseJson(status.label, text, options.schema);
}

/** Ask OpenAI or Gemini for plain text. */
export async function askText(status: ProviderStatus, options: AskOptions, env: Env = process.env, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  if (status.kind === "openai-chat") return openai(status, options, null, env, fetchImpl);
  if (status.kind === "gemini") return gemini(status, options, null, env, fetchImpl);
  return unsupported(status);
}

function unsupported(status: ProviderStatus): never {
  throw new Error(`${status.label} goes through its own client, not askJson or askText.`);
}
