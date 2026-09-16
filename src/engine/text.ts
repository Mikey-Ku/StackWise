import type { CatalogIndex } from "./evaluate";
import type { FactDef, FactValue, SizeId } from "./schema";

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

/** A service's name as a possessive: "Neon's", but "Cloudflare Workers'". */
export function possessive(name: string): string {
  return `${name}${name.endsWith("s") ? "'" : "'s"}`;
}

const VALUE_LABELS: Record<string, string> = {
  none: "None",
  just_me: "Just you",
  up_to_100: "Up to 100 people",
  up_to_1000: "Up to 1,000 people",
  more: "More than 1,000 people",
  high: "Easy",
  medium: "Some work",
  low: "Hard",
  serverless: "Serverless functions",
  server: "Always-on server",
  edge: "Edge functions",
  static: "Static files only",
  paid_addon: "Paid add-on",
  included: "Included",
  hosted: "Hosted for you",
  local_file: "A file on your server",
  relational: "Tables (relational)",
  document: "Documents",
  key_value: "Keys and values",
  full: "full",
  partial: "partial",
};

/** A fact value in words a beginner reads. */
export function formatFactValue(index: CatalogIndex, def: FactDef | undefined, value: FactValue): string {
  if (value === null) return def?.type === "number_or_null" ? "No monthly plan" : "Not verified";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return def?.type === "number_or_null" ? `$${value}/month` : String(value);
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([id, level]) => `${index.optionsById.get(id)?.name ?? id}: ${VALUE_LABELS[level] ?? level}`)
      .join(", ");
  }
  return VALUE_LABELS[value] ?? value;
}
