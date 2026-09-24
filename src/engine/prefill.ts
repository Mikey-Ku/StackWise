import type { Need } from "./schema";

/**
 * Keyword pre-fill: the baseline. It reads the beginner's description and guesses "yes" for a
 * need when one of its keywords appears, recording the exact words it matched so the planner can
 * show why it guessed. It never guesses "no". An AI pre-fill will replace it, and this is what
 * that AI gets measured against.
 *
 * Keyword syntax: a trailing * matches any word ending ("pay*" matches pay, payment, paying). A
 * leading - marks a phrase that must not count: "-video call*" keeps "video call" from matching
 * "video*", while "upload a video" still does.
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
    // Blank out the phrases that don't count, keeping every other character where it was.
    const text = need.keywords
      .filter((k) => k.startsWith("-"))
      .reduce((t, k) => t.replace(new RegExp(keywordPattern(k.slice(1)).source, "gi"), (m) => " ".repeat(m.length)), description);
    for (const keyword of need.keywords.filter((k) => !k.startsWith("-"))) {
      const match = text.match(keywordPattern(keyword));
      if (match) {
        guesses[need.id] = match[0];
        break;
      }
    }
  }
  return guesses;
}
