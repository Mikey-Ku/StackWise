import type { SizeId } from "./schema";

/** An audience size as it reads mid-sentence: "free for just you", "$20/mo at up to 1,000 people". */
export const SIZE_PHRASE: Record<SizeId, string> = {
  just_me: "just you",
  up_to_100: "up to 100 people",
  up_to_1000: "up to 1,000 people",
  more: "more than 1,000 people",
};

/** A label used mid-sentence: "Background jobs" becomes "background jobs", but "AI features" stays. */
export function inSentence(label: string): string {
  const firstWord = label.split(/\s+/)[0] ?? "";
  if (firstWord.length > 1 && firstWord === firstWord.toUpperCase() && /[A-Z]/.test(firstWord)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}
