"use client";

import { useState, type CSSProperties } from "react";
import type { CatalogIndex, FactDef, FactValue, Level, Logo as LogoFile, Stat } from "@/engine";

export type Verdict = Level | "works";

/**
 * A service's logo from public/logos (see data/logos.json for where each one came from). The name
 * always sits next to it, so the image is decorative. A missing or broken file shows the first letter.
 */
export function Logo({ logo, name, size = 20, status }: { logo: LogoFile | undefined; name: string; size?: number; status?: { level: Verdict; title: string } }) {
  const [broken, setBroken] = useState<string | null>(null);
  const style = { "--ws-logo": `${size}px` } as CSSProperties;
  const file = logo?.file !== broken ? logo?.file : undefined;
  return (
    <span className="ws-logo-wrap" style={style}>
      <span className={cx("ws-logo", file ? `ws-logo--${logo!.from}` : "ws-logo--letter")} aria-hidden>
        {file ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny static icons; next/image's resizing adds nothing here
          <img src={`/logos/${file}`} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(file)} />
        ) : (
          name.slice(0, 1).toUpperCase()
        )}
      </span>
      {status && <VerdictDot level={status.level} title={status.title} className="ws-logo-status" />}
    </span>
  );
}

/** Short stats as chips, for cards and canvas nodes. Hover shows the full label and the fact's note. */
export function StatChips({ stats, className }: { stats: Stat[]; className?: string }) {
  if (stats.length === 0) return null;
  return (
    <div className={cx("ws-stats", className)}>
      {stats.map((s) => (
        <span key={s.id} className={`ws-stat ws-stat--${s.tone}`} title={s.note ? `${s.label}: ${s.value}\n${s.note}` : `${s.label}: ${s.value}`}>
          {s.short}
        </span>
      ))}
    </div>
  );
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <dl className="ws-statgrid">
      {stats.map((s) => (
        <div key={s.id} className={`ws-statgrid__item ws-statgrid__item--${s.tone}`} title={s.note}>
          <dt>{s.label}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

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

export function VerdictDot({ level, title, className }: { level: Verdict; title?: string; className?: string }) {
  return <span className={cx("ws-vdot", `ws-vdot--${level}`, className)} title={title ?? VERDICT_UI[level].label} aria-label={title ?? VERDICT_UI[level].label} role="img" />;
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
