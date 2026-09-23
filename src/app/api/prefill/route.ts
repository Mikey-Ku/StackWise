import { NextResponse } from "next/server";
import { z } from "zod";
import { describeAiError, getClient } from "@/ai/config";
import { aiPrefill, providerPrefill, type Guess } from "@/ai/prefill";
import { chooseProvider, PROVIDER_IDS, type ProviderId } from "@/ai/providers";
import { takeAiCall, visitorId } from "@/ai/rate-limit";
import { loadCatalog } from "@/engine/load";
import { prefillFromKeywords } from "@/engine/prefill";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ description: z.string().trim().min(1).max(5000), provider: z.string().max(40).refine((id) => PROVIDER_IDS.includes(id)).optional() });

export interface PrefillResponse {
  by: "ai" | "keywords";
  provider?: ProviderId;
  guesses: Record<string, Guess>;
  features: string[];
  note?: string;
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a description between 1 and 5,000 characters." }, { status: 400 });
  const { description, provider } = parsed.data;
  const catalog = loadCatalog();

  const keywords = (note?: string): PrefillResponse => ({
    by: "keywords",
    guesses: Object.fromEntries(Object.entries(prefillFromKeywords(description, catalog.needs)).map(([id, words]) => [id, { answer: "yes", evidence: words }])),
    features: [],
    note,
  });

  const chosen = chooseProvider(provider) ?? (provider ? chooseProvider(undefined) : null);
  if (!chosen) return NextResponse.json(keywords());
  if (!takeAiCall(visitorId(request))) return NextResponse.json(keywords("You've hit the hourly AI limit, so keywords were used instead."));

  try {
    const result = chosen.id === "claude" ? await aiPrefill(getClient(), catalog, description) : await providerPrefill(chosen, catalog, description);
    const response: PrefillResponse = { by: "ai", provider: chosen.id, guesses: result.guesses, features: result.features };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(keywords(describeAiError(error)));
  }
}
