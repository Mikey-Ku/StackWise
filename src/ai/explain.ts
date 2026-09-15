import type Anthropic from "@anthropic-ai/sdk";
import type { PlanBrief } from "@/engine/summary";
import { AI_EFFORT, AI_MODEL, AiError, FALLBACK_BETA, withoutEmDashes } from "./config";

/**
 * The plain-language explanation of a plan. The model gets only the computed brief, so it can
 * reword what the rules decided but has nothing to invent a price or a compatibility claim from.
 */

const SYSTEM = `You explain a web app plan to a beginner who is about to build it.

Write three short paragraphs, 170 words at most in total:
1. What the stack is and why it fits what they described.
2. The most important problem to fix or watch, and how to fix it. If there are no problems, say what to keep an eye on as the app grows.
3. What it costs now and as it grows.

Use only the plan below. Don't add services, prices, limits, features or advice that aren't in it. Plain words; if you use a technical term, explain it in the same sentence. No headings, no lists, no em dashes.`;

export async function aiExplain(client: Anthropic, brief: PlanBrief): Promise<string> {
  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: AI_EFFORT },
    system: SYSTEM,
    messages: [{ role: "user", content: `<plan>\n${JSON.stringify(brief, null, 2)}\n</plan>` }],
  });
  if (response.stop_reason === "refusal") throw new AiError("Claude declined to explain this plan, so the standard summary is shown.", "refused");
  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  if (!text) throw new AiError("Claude returned an empty explanation, so the standard summary is shown.", "bad_output");
  return withoutEmDashes(text);
}
