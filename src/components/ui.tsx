"use client";

import type { Level } from "@/engine";

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
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          data-on={value === o.id}
          className="mk-seg__opt"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
