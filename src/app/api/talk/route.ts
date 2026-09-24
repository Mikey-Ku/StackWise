import { NextResponse } from "next/server";
import { z } from "zod";
import { describeAiError, getClient } from "@/ai/config";
import { chooseProvider, PROVIDER_IDS } from "@/ai/providers";
import { takeAiCall, visitorId } from "@/ai/rate-limit";
import { aiTalk, providerTalk } from "@/ai/talk";
import { evaluatePlan, indexCatalog, worstLevel } from "@/engine/evaluate";
import { loadCatalog } from "@/engine/load";
import { planInput } from "@/engine/planops";
import { SLOT_IDS } from "@/engine/schema";
import { recommend } from "@/engine/score";
import { sharedPlanSchema } from "@/engine/share";
import { answerFromFacts, talkBrief } from "@/engine/talk";
import { readJson, sameOrigin } from "@/mcp/local";

/**
 * Talking one part of the plan through. The browser sends the plan, the part, the conversation
 * and the question; the server rebuilds the brief itself, asks Claude when it's on, and otherwise
 * answers from StackWise's facts. A suggested swap comes back with the verdict StackWise's rules
 * give it, so the page never shows Claude's word for whether something works.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  plan: sharedPlanSchema,
  slot: z.enum(SLOT_IDS),
  question: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(["you", "claude", "facts"]), text: z.string().max(4000) }))
    .max(40)
    .default([]),
  /** The person picked "StackWise facts" to answer: skip AI even when a key is set. */
  factsOnly: z.boolean().optional(),
  /** Which built-in AI answers. Left out, the first with a key, Claude first. */
  provider: z.string().max(40).refine((id) => PROVIDER_IDS.includes(id)).optional(),
});

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Send { plan, slot, question } with a valid plan." }, { status: 400 });
  const { plan, slot, question, history, factsOnly, provider } = parsed.data;

  const index = indexCatalog(loadCatalog());
  const brief = talkBrief(index, plan, slot);

  const withVerdict = (optionId: string | undefined) => {
    if (!optionId) return undefined;
    const option = index.optionsById.get(optionId);
    if (!option) return undefined;
    const input = planInput(plan);
    const selection = { ...recommend(index, input, plan.pinned).selection, [slot]: optionId };
    const verdict = worstLevel(evaluatePlan(index, selection, input).filter((r) => r.slots.includes(slot)));
    return { optionId, name: option.name, verdict };
  };

  const facts = (note?: string) => {
    const answer = answerFromFacts(brief, question);
    return NextResponse.json({ by: "facts", reply: answer.reply, proposal: answer.proposal, swap: withVerdict(answer.swap), note });
  };

  if (factsOnly) return facts();
  const chosen = chooseProvider(provider);
  if (!chosen) return facts(provider ? `${provider} isn't set up in .env.local, so StackWise answered from its facts.` : undefined);
  if (!takeAiCall(visitorId())) return facts("You've hit the hourly AI limit, so StackWise answered from its facts.");
  try {
    const answer = chosen.id === "claude" ? await aiTalk(getClient(), brief, history, question) : await providerTalk(chosen, brief, history, question);
    return NextResponse.json({ by: "ai", provider: chosen.id, reply: answer.reply, proposal: answer.proposal, swap: withVerdict(answer.swap) });
  } catch (error) {
    return facts(describeAiError(error).replace("keywords were used instead", "StackWise answered from its facts"));
  }
}
