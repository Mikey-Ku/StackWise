"use client";

import type { CatalogIndex, FactDef, FactValue, Level } from "@/engine";

export type Verdict = Level | "works";

export const VERDICT_UI: Record<Verdict, { label: string; short: string; badge: string }> = {
  blocked: { label: "Doesn't work", short: "Doesn't work", badge: "mk-badge--danger" },
  missing: { label: "Missing a piece", short: "Missing", badge: "mk-badge--danger" },
  warning: { label: "Works with a warning", short: "Warning", badge: "mk-badge--warn" },
  unknown: { label: "Not verified yet", short: "Not verified", badge: "ws-badge--unknown" },
  info: { label: "Good to know", short: "Note", badge: "mk-badge--accent" },
  works: { label: "Works", short: "Works", badge: "mk-badge--ok" },
};

export function VerdictBadge({ level, short = false }: { level: Verdict; short?: boolean }) {
  const ui = VERDICT_UI[level];
  return (
    <span className={`mk-badge ${ui.badge}`}>
      <span className="mk-dot" aria-hidden />
      {short ? ui.short : ui.label}
    </span>
  );
}

export function VerdictDot({ level, title }: { level: Verdict; title?: string }) {
  return <span className={`ws-vdot ws-vdot--${level}`} title={title ?? VERDICT_UI[level].label} aria-label={title ?? VERDICT_UI[level].label} role="img" />;
}

export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="mk-seg ws-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} data-on={value === o.id} className="mk-seg__opt" onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
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

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(name: string, content: string, type = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
