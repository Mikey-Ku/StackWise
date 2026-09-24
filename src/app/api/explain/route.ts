import { NextResponse } from "next/server";
import { z } from "zod";
import { describeAiError, getClient } from "@/ai/config";
import { aiExplain, providerExplain } from "@/ai/explain";
import { chooseProvider, PROVIDER_IDS } from "@/ai/providers";
import { takeAiCall, visitorId } from "@/ai/rate-limit";
import { indexCatalog } from "@/engine/evaluate";
import { loadCatalog } from "@/engine/load";
import { PRIORITY_IDS, SIZE_IDS, SLOT_IDS } from "@/engine/schema";
import { recommend } from "@/engine/score";
import { planBrief, templateSummary } from "@/engine/summary";
import { readJson, sameOrigin } from "@/mcp/local";

export const dynamic = "force-dynamic";

// The client sends its answers and choices, never results: the server recomputes the plan itself.
const bodySchema = z.object({
  appName: z.string().max(200),
  description: z.string().max(5000),
  answers: z.record(z.string(), z.enum(["yes", "no", "not_sure"])),
  size: z.enum(SIZE_IDS),
  priority: z.enum(PRIORITY_IDS),
  pinned: z.partialRecord(z.enum(SLOT_IDS), z.string().max(80)),
  /** The person picked "StackWise facts" to answer: use the template even when AI is on. */
  factsOnly: z.boolean().optional(),
  provider: z.string().max(40).refine((id) => PROVIDER_IDS.includes(id)).optional(),
});

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "That plan couldn't be read." }, { status: 400 });
  const { appName, description, answers, size, priority, pinned, factsOnly, provider } = parsed.data;

  const index = indexCatalog(loadCatalog());
  const input = { answers, size, priority };
  const brief = planBrief(index, input, recommend(index, input, pinned), appName, description);
  const template = (note?: string) => NextResponse.json({ by: "template", text: templateSummary(brief), note });

  const chosen = factsOnly ? null : chooseProvider(provider);
  if (!chosen) return template();
  if (!takeAiCall(visitorId())) return template("You've hit the hourly AI limit, so the standard summary is shown.");
  try {
    const text = chosen.id === "claude" ? await aiExplain(getClient(), brief) : await providerExplain(chosen, brief);
    return NextResponse.json({ by: "ai", provider: chosen.id, text });
  } catch (error) {
    return template(describeAiError(error).replace("keywords were used instead", "the standard summary is shown"));
  }
}
