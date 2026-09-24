import { setting } from "@/engine/names";

/**
 * A small in-memory limit on AI calls per visitor, so a public deployment can't run up the API
 * bill. It resets when the server restarts, which is fine for a single instance.
 */

const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

export function aiLimitPerHour(): number {
  const parsed = Number(setting("AI_LIMIT_PER_HOUR"));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export function takeAiCall(visitor: string, now = Date.now(), limit = aiLimitPerHour()): boolean {
  const recent = (hits.get(visitor) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(visitor, recent);
    return false;
  }
  recent.push(now);
  hits.set(visitor, recent);
  return true;
}

export function visitorId(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

export function resetAiLimits(): void {
  hits.clear();
}
