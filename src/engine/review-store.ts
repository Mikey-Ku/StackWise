import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { setting } from "./names";
import { editFactReview } from "./review";
import { factValueSchema, optionSchema, type FactValue } from "./schema";

/**
 * Node-only: what the review page's decisions do on disk. "Matches the source" marks one fact
 * verified in its option file, with the day, and changes nothing else in the file. "Something's
 * off" writes the comment to a log in StackWise's own folder (.stackwise/review-flags.json,
 * gitignored) for whoever fixes the fact, and leaves the fact a draft. Never import from a client
 * component.
 */

export const FLAGS_FILE = "review-flags.json";

const flagSchema = z.object({
  comment: z.string(),
  flagged: z.string(),
  /** The fact as it was when flagged, so a later fix shows. */
  value: factValueSchema,
  retrieved: z.string(),
});
export type ReviewFlag = z.infer<typeof flagSchema>;
/** By "<optionId>.<fact>". */
export type ReviewFlags = Record<string, ReviewFlag>;

/** Reviewing writes to data/, so a hosted StackWise has no review page or route at all. */
export function reviewHidden(env: Record<string, string | undefined> = process.env): boolean {
  return setting("HOSTED", env) === "1" || env.NEXT_PUBLIC_STACKWISE_HOSTED === "1";
}

export function readFlags(stateDir: string): ReviewFlags {
  try {
    const parsed = z.object({ flags: z.record(z.string(), flagSchema) }).safeParse(JSON.parse(fs.readFileSync(path.join(stateDir, FLAGS_FILE), "utf8")));
    return parsed.success ? parsed.data.flags : {};
  } catch {
    return {};
  }
}

function writeFlags(stateDir: string, flags: ReviewFlags): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, FLAGS_FILE), `${JSON.stringify({ flags }, null, 2)}\n`);
}

export const OPTION_ID = /^[a-z0-9-]{1,80}$/;
export const FACT_KEY = /^[a-z0-9_]{1,80}$/;
export const COMMENT_MAX = 2000;

export interface ReviewRequest {
  optionId: string;
  fact: string;
  decision: "confirm" | "flag";
  comment?: string;
}

export type ReviewResult =
  | { ok: true; key: string; status: "draft" | "verified"; reviewed?: string; flag?: ReviewFlag }
  | { ok: false; code: 400 | 404; error: string };

/**
 * Apply one decision. `dataDir` holds options/<id>.json, `stateDir` the flags log, and `today`
 * is the reviewer's date. Refuses an option or fact the data doesn't have. A flag on a fact
 * that was already verified puts it back to draft: someone just said it's off.
 */
export function applyReview(dataDir: string, stateDir: string, request: ReviewRequest, today: string): ReviewResult {
  const { optionId, fact, decision } = request;
  if (!OPTION_ID.test(optionId) || !FACT_KEY.test(fact)) return { ok: false, code: 400, error: "Send an option id and a fact key." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return { ok: false, code: 400, error: "today must be YYYY-MM-DD." };

  const file = path.join(dataDir, "options", `${optionId}.json`);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, code: 404, error: `No option "${optionId}".` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: 400, error: `data/options/${optionId}.json isn't valid JSON.` };
  }
  const parsed = optionSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== optionId) return { ok: false, code: 400, error: `data/options/${optionId}.json doesn't hold option "${optionId}".` };
  const current = parsed.data.facts[fact];
  if (!Object.hasOwn(parsed.data.facts, fact) || !current) return { ok: false, code: 404, error: `${parsed.data.name} has no fact "${fact}".` };

  const key = `${optionId}.${fact}`;
  const flags = readFlags(stateDir);
  const write = (next: string) => {
    // The edit is checked to change only this fact's review; the schema check is one more guard before it lands.
    optionSchema.parse(JSON.parse(next));
    if (next !== text) fs.writeFileSync(file, next);
  };

  if (decision === "confirm") {
    write(editFactReview(text, fact, { status: "verified", reviewed: today }));
    if (flags[key]) {
      delete flags[key];
      writeFlags(stateDir, flags);
    }
    return { ok: true, key, status: "verified", reviewed: today };
  }

  const comment = (request.comment ?? "").trim().slice(0, COMMENT_MAX);
  const flag: ReviewFlag = { comment, flagged: today, value: current.value as FactValue, retrieved: current.retrieved };
  if (current.status === "verified") write(editFactReview(text, fact, { status: "draft" }));
  writeFlags(stateDir, { ...flags, [key]: flag });
  return { ok: true, key, status: "draft", flag };
}
