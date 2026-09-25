import { NextResponse } from "next/server";
import { chooseProvider, providerStatus } from "@/ai/providers";
import { aiLimitPerHour } from "@/ai/rate-limit";
import { sameOrigin } from "@/mcp/local";

export const dynamic = "force-dynamic";

/** Which built-in AI can answer, and with which model. Key names only, never values. */
export function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  const providers = providerStatus();
  const first = chooseProvider(undefined);
  return NextResponse.json({ ai: Boolean(first), model: first?.model ?? "", providers, limitPerHour: aiLimitPerHour(), root: process.cwd() });
}
