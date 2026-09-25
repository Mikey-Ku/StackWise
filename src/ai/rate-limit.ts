import { setting } from "@/engine/names";

/**
 * A small in-memory limit on AI calls, so nothing can run up the API bill in a loop. StackWise
 * answers only this computer, so there is one bucket for everyone who uses it; request headers
 * like X-Forwarded-For are never trusted, because any caller can set them.
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

export function visitorId(): string {
  return "local";
}

export function resetAiLimits(): void {
  hits.clear();
}
