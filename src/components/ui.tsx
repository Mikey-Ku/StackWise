"use client";

import { strToU8, zipSync } from "fflate";
import { useCallback, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { Level, Logo as LogoFile, Stat } from "@/engine";

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
        {file && logo!.dark ? (
          // A near-black mark is drawn in the text color, so it doesn't vanish in dark mode.
          <span className="ws-logo__mono" style={{ maskImage: `url(/logos/${file})`, WebkitMaskImage: `url(/logos/${file})` }} />
        ) : file ? (
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

/** Two columns of stats. Long values, like a price breakdown, go last at full width, and so does a short stat left alone on its row. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  const long = (s: Stat) => s.value.length > 36;
  const short = stats.filter((s) => !long(s));
  const items = [...short, ...stats.filter(long)];
  const wide = (s: Stat) => long(s) || (short.length % 2 === 1 && s === short[short.length - 1]);
  return (
    <dl className="ws-statgrid">
      {items.map((s) => (
        <div key={s.id} className={cx("ws-statgrid__item", `ws-statgrid__item--${s.tone}`, wide(s) && "ws-statgrid__item--wide")} title={s.note}>
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

/** Whether a CSS media query matches right now, following changes as the window resizes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Many files as one zip inside a folder, so dotfiles like .mcp.json and folders like .claude survive the download. */
export function downloadZip(name: string, folder: string, files: { name: string; content: string }[]): void {
  const zipped = zipSync(Object.fromEntries(files.map((f) => [`${folder}/${f.name}`, strToU8(f.content)])), { level: 6 });
  const url = URL.createObjectURL(new Blob([new Uint8Array(zipped)], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(name: string, content: string, type = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * An image the person picked, as a 128px square data URL, so an app logo stays small enough to
 * keep with the plan in this browser. SVGs under 64KB are kept as they are, since they scale.
 */
export async function imageToIcon(file: Blob): Promise<string> {
  const read = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Couldn't read that image."));
      reader.readAsDataURL(blob);
    });
  if (file.type === "image/svg+xml" && file.size < 64 * 1024) return read(file);
  const url = await read(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const scale = Math.min(size / image.width, size / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  canvas.getContext("2d")!.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/png");
}

