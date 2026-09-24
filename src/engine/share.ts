import { z } from "zod";
import { PRIORITY_IDS, SIZE_IDS, SLOT_IDS } from "./schema";

/**
 * Share links. The whole plan fits in the link itself (compressed, then base64url), so sharing
 * needs no account and no server, and nothing leaves the browser until someone opens the link.
 */

const answerSchema = z.enum(["yes", "no", "not_sure"]);

/**
 * Text that has to stay on one line: it ends up in YAML frontmatter, `#` comments in env files
 * and headings, where a newline from a crafted share link could add a line of its own.
 */
export const oneLine = (max: number) =>
  z
    .string()
    .max(max)
    .transform((text) => text.replace(/\s*[\r\n]+\s*/g, " "));
const optionIdSchema = z.string().regex(/^[a-z0-9-]*$/).max(80);
/** A share link or plan file this big isn't a plan; it's an attempt to hang the tab. */
const MAX_SHARED_BYTES = 1024 * 1024;

export const NOTE_MAX = 4000;

/**
 * A person's note on one part of the stack and the line to it: how it's wired, what to watch,
 * what they decided. It remembers which option filled the part when it was written, so a swap
 * can flag a note that may no longer apply. Claude can write one too, and says so.
 */
export const noteSchema = z.object({
  text: z.string().max(NOTE_MAX),
  optionId: optionIdSchema.optional(),
  updatedAt: z.string().max(40),
  by: z.enum(["you", "claude"]),
});
export type Note = z.infer<typeof noteSchema>;

/**
 * A part StackWise has no facts on, added by the person (or their AI): a vector database, an
 * internal API, a library. It sits on the canvas with a line to the app and goes into the spec,
 * but no rule checks it and nothing prices it, so it's never "works", only "not checked".
 */
export const CUSTOM_ID = /^custom-[a-z0-9-]{1,40}$/;
export const customPartSchema = z.object({
  name: z.string().trim().min(1).max(60).transform((text) => text.replace(/\s*[\r\n]+\s*/g, " ")),
  /** What it does for the app, read as "the app ___ it": "searches documents with". */
  role: oneLine(80).default(""),
  url: oneLine(300).default(""),
  /** Environment variable names the code reads for it. Names only, never values. */
  env: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(120)).max(20).default([]),
  note: z.string().max(NOTE_MAX).default(""),
});
export type CustomPart = z.infer<typeof customPartSchema>;

export const sharedPlanSchema = z.object({
  v: z.literal(1),
  appName: oneLine(200),
  description: z.string().max(5000),
  features: z.string().max(5000),
  answers: z.record(z.string().max(40), answerSchema).refine((answers) => Object.keys(answers).length <= 100, "too many answers"),
  size: z.enum(SIZE_IDS),
  priority: z.enum(PRIORITY_IDS),
  builderId: z.string().regex(/^[a-z0-9-]*$/).max(40),
  pinned: z.partialRecord(z.enum(SLOT_IDS), optionIdSchema),
  /** Added after the first release, so links and plan files without notes still open. */
  notes: z.partialRecord(z.enum(SLOT_IDS), noteSchema).default({}),
  /** The person's own parts, by id. Left out by older links and plan files. */
  custom: z
    .record(z.string().regex(CUSTOM_ID), customPartSchema)
    .refine((parts) => Object.keys(parts).length <= 40, "too many parts")
    .optional(),
});
export type SharedPlan = z.infer<typeof sharedPlanSchema>;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(token: string): Uint8Array {
  const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Runs bytes through a (de)compression stream, stopping with an error past `maxBytes` of output. */
async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, maxBytes = Infinity): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const reader = new Blob([copy]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("too big");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export async function encodeSharedPlan(plan: SharedPlan): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(sharedPlanSchema.parse(plan)));
  return toBase64Url(await transform(json, new CompressionStream("deflate-raw")));
}

/** Returns null for anything that isn't a valid StackWise plan, instead of throwing. */
export async function decodeSharedPlan(token: string): Promise<SharedPlan | null> {
  try {
    if (token.length > MAX_SHARED_BYTES) return null;
    const json = await transform(fromBase64Url(token), new DecompressionStream("deflate-raw"), MAX_SHARED_BYTES);
    const result = sharedPlanSchema.safeParse(JSON.parse(new TextDecoder().decode(json)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
