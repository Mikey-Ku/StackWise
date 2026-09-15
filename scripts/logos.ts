import fs from "node:fs";
import path from "node:path";
import type { Logo } from "@/engine/schema";
import { ROOT } from "./lib";

/**
 * Fetching logos for data/logos.json, shared by build-logos.ts and draft-option.ts:
 * - "simple-icons": the brand's icon from the Simple Icons package, in its brand color
 * - "site": the icon the company's own website declares (apple-touch-icon, then icon, then favicon)
 *
 * Logos are trademarks of their owners and are used only to identify each service.
 */

export type BuiltLogo = Logo & { file: string; source: string };

export const LOGOS_DIR = path.join(ROOT, "public", "logos");
export const LOGOS_MANIFEST = path.join(ROOT, "data", "logos.json");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const EXTENSIONS: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

/** Very light brand colors would vanish on white paper; draw those in ink instead. */
export function readableHex(hex: string): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.8 ? "15171A" : hex;
}

/** The icon links a page declares, best first, then /favicon.ico. */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const scored = links
    .map((tag) => ({ rel: (attr(tag, "rel") ?? "").toLowerCase(), href: attr(tag, "href"), sizes: attr(tag, "sizes") ?? "", type: attr(tag, "type") ?? "", media: attr(tag, "media") ?? "" }))
    .filter((l) => l.href && l.rel.split(/\s+/).some((r) => r === "icon" || r === "apple-touch-icon" || r === "apple-touch-icon-precomposed"))
    // An icon meant for dark browser chrome is usually a white mark, which vanishes on a white card.
    .filter((l) => !/prefers-color-scheme:\s*dark/i.test(l.media))
    .map((l) => {
      const size = Math.max(0, ...l.sizes.split(/\s+/).map((s) => Number(s.split("x")[0]) || 0));
      const score = (l.rel.includes("apple-touch-icon") ? 400 : 0) + (l.type.includes("svg") || l.href!.endsWith(".svg") ? 300 : 0) + Math.min(size, 256);
      return { href: new URL(l.href!, pageUrl).toString(), score };
    })
    .sort((a, b) => b.score - a.score);
  return [...new Set([...scored.map((s) => s.href), new URL("/favicon.ico", pageUrl).toString()])];
}

export async function fromSimpleIcons(id: string, slug: string): Promise<BuiltLogo> {
  const simpleIcons = await import("simple-icons");
  const icon = Object.values(simpleIcons).find((i): i is (typeof simpleIcons)["siVercel"] => typeof i === "object" && i !== null && "slug" in i && i.slug === slug);
  if (!icon) throw new Error(`${id}: Simple Icons has no "${slug}"`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img"><title>${icon.title}</title><path fill="#${readableHex(icon.hex)}" d="${icon.path}"/></svg>\n`;
  const file = `${id}.svg`;
  fs.writeFileSync(path.join(LOGOS_DIR, file), svg);
  return { from: "simple-icons", slug, file, source: `https://simpleicons.org/?q=${slug}` };
}

async function download(url: string): Promise<{ bytes: Buffer; ext: string } | null> {
  try {
    const response = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = EXTENSIONS[type] ?? (url.match(/\.(svg|png|ico|webp|jpg)(\?|$)/)?.[1] ?? null);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!ext || bytes.length < 100) return null;
    return { bytes, ext };
  } catch {
    return null;
  }
}

export async function fromSite(id: string, pageUrl: string): Promise<BuiltLogo> {
  let candidates: string[] = [];
  try {
    const response = await fetch(pageUrl, { headers: { "user-agent": UA }, redirect: "follow" });
    candidates = iconCandidates(await response.text(), response.url || pageUrl);
  } catch {
    candidates = [new URL("/favicon.ico", pageUrl).toString()];
  }
  // Some sites refuse scripted requests; Google's favicon service serves the same icon they publish.
  const fallback = `https://www.google.com/s2/favicons?domain=${new URL(pageUrl).hostname}&sz=128`;
  for (const url of [...candidates, fallback]) {
    const result = await download(url);
    if (!result) continue;
    const file = `${id}.${result.ext}`;
    fs.mkdirSync(LOGOS_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOGOS_DIR, file), result.bytes);
    return { from: "site", url: pageUrl, file, source: url };
  }
  throw new Error(`${id}: no usable icon found on ${pageUrl}`);
}

export function buildLogo(id: string, entry: Logo): Promise<BuiltLogo> {
  return entry.from === "simple-icons" ? fromSimpleIcons(id, entry.slug) : fromSite(id, entry.url);
}

export function readManifest(): Record<string, Logo> {
  return JSON.parse(fs.readFileSync(LOGOS_MANIFEST, "utf8")) as Record<string, Logo>;
}

export function writeManifest(manifest: Record<string, Logo>): void {
  fs.writeFileSync(LOGOS_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}
