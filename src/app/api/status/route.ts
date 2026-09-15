import { NextResponse } from "next/server";
import { AI_MODEL, aiEnabled } from "@/ai/config";
import { aiLimitPerHour } from "@/ai/rate-limit";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ai: aiEnabled(), model: AI_MODEL, limitPerHour: aiLimitPerHour(), root: process.cwd() });
}
