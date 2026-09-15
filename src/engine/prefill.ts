import type { Need } from "./schema";

/**
 * Keyword pre-fill: the baseline. It reads the beginner's description and guesses "yes" for a
 * need when one of its keywords appears, recording the exact words it matched so the planner can
 * show why it guessed. It never guesses "no". An AI pre-fill will replace it, and this is what
 * that AI gets measured against.
 *
 * Keyword syntax: a trailing * matches any word ending ("pay*" matches pay, payment, paying).
 */

function keywordPattern(keyword: string): RegExp {
  const prefix = keyword.endsWith("*");
  const body = (prefix ? keyword.slice(0, -1) : keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startsWord = /^\w/.test(keyword);
  const endsWord = /\w$/.test(prefix ? keyword.slice(0, -1) : keyword);
  const start = startsWord ? "\\b" : "";
  const end = prefix ? "\\w*" : endsWord ? "\\b" : "";
  return new RegExp(`${start}${body}${end}`, "i");
}

export function prefillFromKeywords(description: string, needs: Need[]): Record<string, string> {
  const guesses: Record<string, string> = {};
  for (const need of needs) {
    for (const keyword of need.keywords) {
      const match = description.match(keywordPattern(keyword));
      if (match) {
        guesses[need.id] = match[0];
        break;
      }
    }
  }
  return guesses;
}
