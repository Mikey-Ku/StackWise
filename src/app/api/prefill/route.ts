import { NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled, describeAiError, getClient } from "@/ai/config";
import { aiPrefill, type Guess } from "@/ai/prefill";
import { takeAiCall, visitorId } from "@/ai/rate-limit";
import { loadCatalog } from "@/engine/load";
import { prefillFromKeywords } from "@/engine/prefill";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ description: z.string().trim().min(1).max(5000) });

export interface PrefillResponse {
  by: "ai" | "keywords";
  guesses: Record<string, Guess>;
  features: string[];
  note?: string;
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a description between 1 and 5,000 characters." }, { status: 400 });
  const { description } = parsed.data;
  const catalog = loadCatalog();

  const keywords = (note?: string): PrefillResponse => ({
    by: "keywords",
    guesses: Object.fromEntries(Object.entries(prefillFromKeywords(description, catalog.needs)).map(([id, words]) => [id, { answer: "yes", evidence: words }])),
    features: [],
    note,
  });

  if (!aiEnabled()) return NextResponse.json(keywords());
  if (!takeAiCall(visitorId(request))) return NextResponse.json(keywords("You've hit the hourly AI limit, so keywords were used instead."));

  try {
    const result = await aiPrefill(getClient(), catalog, description);
    const response: PrefillResponse = { by: "ai", guesses: result.guesses, features: result.features };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(keywords(describeAiError(error)));
  }
}
