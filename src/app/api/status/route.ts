import { NextResponse } from "next/server";
import { chooseProvider, providerStatus } from "@/ai/providers";
import { aiLimitPerHour } from "@/ai/rate-limit";

export const dynamic = "force-dynamic";

/** Which built-in AI can answer, and with which model. Key names only, never values. */
export function GET() {
  const providers = providerStatus();
  const first = chooseProvider(undefined);
  return NextResponse.json({ ai: Boolean(first), model: first?.model ?? "", providers, limitPerHour: aiLimitPerHour(), root: process.cwd() });
}
