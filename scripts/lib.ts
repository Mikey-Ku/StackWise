import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { aiEnabled } from "@/ai/config";
import { loadCatalog } from "@/engine/load";

/** Shared helpers for the command-line scripts. Run them from the project root with pnpm. */

export const ROOT = process.cwd();

export function projectCatalog() {
  return loadCatalog(path.join(ROOT, "data"));
}

export function args(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

export function requireAi(): void {
  if (aiEnabled()) return;
  console.error("This script calls Claude. Put ANTHROPIC_API_KEY in .env.local (it's gitignored) and run it again.");
  process.exit(1);
}

export function writeReport(name: string, content: string): string {
  const dir = path.join(ROOT, "reports");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return path.relative(ROOT, file);
}

/** Server tools can pause a long turn. Keep going until the model is done. */
export async function createUntilDone(
  client: Anthropic,
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  maxContinuations = 4,
): Promise<Anthropic.Beta.Messages.BetaMessage> {
  const messages = [...params.messages];
  for (let i = 0; ; i++) {
    const response = await client.beta.messages.create({ ...params, messages });
    if (response.stop_reason !== "pause_turn" || i >= maxContinuations) return response;
    messages.push({ role: "assistant", content: response.content });
  }
}

export function textOf(message: Anthropic.Beta.Messages.BetaMessage): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

/** Readable text from an HTML page: no scripts, styles or tags. Nothing is cut off. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
