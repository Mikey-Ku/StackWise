import { z } from "zod";
import { PRIORITY_IDS, SIZE_IDS, SLOT_IDS } from "./schema";

/**
 * Share links. The whole plan fits in the link itself (compressed, then base64url), so sharing
 * needs no account and no server, and nothing leaves the browser until someone opens the link.
 */

const answerSchema = z.enum(["yes", "no", "not_sure"]);

export const NOTE_MAX = 4000;

/**
 * A person's note on one part of the stack and the line to it: how it's wired, what to watch,
 * what they decided. It remembers which option filled the part when it was written, so a swap
 * can flag a note that may no longer apply. Claude can write one too, and says so.
 */
export const noteSchema = z.object({
  text: z.string().max(NOTE_MAX),
  optionId: z.string().max(80).optional(),
  updatedAt: z.string().max(40),
  by: z.enum(["you", "claude"]),
});
export type Note = z.infer<typeof noteSchema>;

export const sharedPlanSchema = z.object({
  v: z.literal(1),
  appName: z.string().max(200),
  description: z.string().max(5000),
  features: z.string().max(5000),
  answers: z.record(z.string(), answerSchema),
  size: z.enum(SIZE_IDS),
  priority: z.enum(PRIORITY_IDS),
  builderId: z.string().max(40),
  pinned: z.partialRecord(z.enum(SLOT_IDS), z.string().max(80)),
  /** Added after the first release, so links and plan files without notes still open. */
  notes: z.partialRecord(z.enum(SLOT_IDS), noteSchema).default({}),
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

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const piped = new Blob([copy]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

export async function encodeSharedPlan(plan: SharedPlan): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(sharedPlanSchema.parse(plan)));
  return toBase64Url(await transform(json, new CompressionStream("deflate-raw")));
}

/** Returns null for anything that isn't a valid StackWise plan, instead of throwing. */
export async function decodeSharedPlan(token: string): Promise<SharedPlan | null> {
  try {
    const json = await transform(fromBase64Url(token), new DecompressionStream("deflate-raw"));
    const result = sharedPlanSchema.safeParse(JSON.parse(new TextDecoder().decode(json)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
