import fs from "node:fs";
import path from "node:path";
import { detectProject, type Detected } from "./detect";
import { gitignoreCovers, parseEnv, setEnv, springEnvRefs } from "./envfile";
import { LEGACY_PLAN_FILE, PLAN_FILE } from "@/engine/names";

/**
 * Node-only. A project folder on this computer, linked to a plan: what it is, which environment
 * variable names its env files set, its icon, and the opening of its README. Every route that
 * calls this answers only this computer (see src/mcp/local.ts) and only for folders
 * resolveFolder allows. Values from env files are never returned; the only write is one variable
 * into the project's .env.local.
 */

const WRITE_TO = ".env.local";

function read(folder: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join(folder, file), "utf8");
  } catch {
    return null;
  }
}

export interface EnvRow {
  name: string;
  set: boolean;
  /** Which files name it. */
  files: string[];
}

export interface Inspection extends Detected {
  folder: string;
  exists: boolean;
  env: EnvRow[];
  /** Names the app's config reads (Spring's ${NAME} placeholders). */
  configRefs: string[];
  /** Whether git keeps .env.local out of commits. */
  envIgnored: boolean;
  /** Whether the project has a StackWise plan file. */
  planFile: boolean;
  /** Things that will leak something, in plain words. */
  issues: string[];
  /** The app's own icon, relative to the folder, when StackWise found one. */
  icon: string | null;
  /** The opening of the project's README, as a starting description for a new plan. */
  readme: string | null;
}

/** The first paragraphs of a README, without headings, badges, code or links, cut to a readable length. */
export function readmeSummary(text: string | null, limit = 700): string | null {
  if (!text) return null;
  const paragraphs = text
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("![") && !p.startsWith("[!") && !p.startsWith("<"))
    .map((p) => p.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " "));
  let out = "";
  for (const p of paragraphs) {
    if (out && out.length + p.length > limit) break;
    out = out ? `${out} ${p}` : p;
  }
  return out ? out.slice(0, limit) : null;
}

const ICON_TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const WEB_ROOTS = ["public", "static", "src/main/resources/static", "app/static", "src/app", "app", "web", "wwwroot", "assets", ""];
const ICON_NAMES = ["icon.svg", "icon.png", "logo.svg", "logo.png", "apple-touch-icon.png", "favicon.svg", "favicon.png", "favicon.ico"];

/** The app's icon: what its HTML links to first, then the usual file names in the usual folders. */
export function findIcon(folder: string): string | null {
  const has = (file: string) => fs.existsSync(path.join(folder, file));
  for (const root of WEB_ROOTS) {
    for (const page of ["index.html", "templates/index.html"]) {
      // Paths in the person's project, not files StackWise ships with: the build's file tracing skips them.
      const html = read(folder, path.join(/* turbopackIgnore: true */ root, page));
      const href = html?.match(/<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*href=["']([^"'?#]+)/i)?.[1] ?? html?.match(/<link[^>]+href=["']([^"'?#]+)["'][^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["']/i)?.[1];
      if (href && !/^(https?:|data:|\/\/)/.test(href)) {
        const file = path.join(/* turbopackIgnore: true */ root, href.replace(/^\//, ""));
        if (has(file) && ICON_TYPES[path.extname(file).toLowerCase()]) return file;
      }
    }
    for (const name of ICON_NAMES) if (has(path.join(/* turbopackIgnore: true */ root, name))) return path.join(/* turbopackIgnore: true */ root, name);
  }
  return null;
}

/** A path inside the folder, following symlinks, or null when it lands outside. */
export function inside(folder: string, relative: string): string | null {
  try {
    const root = fs.realpathSync(folder);
    const full = fs.realpathSync(path.resolve(folder, relative));
    return full === root || full.startsWith(root + path.sep) ? full : null;
  } catch {
    return null;
  }
}

/** An icon from the project as a data URL, small enough to keep with the plan. */
export function iconData(folder: string, file: string): string | null {
  const type = ICON_TYPES[path.extname(file).toLowerCase()];
  // Followed through symlinks: an icon that links to a file elsewhere is never read.
  const full = type ? inside(folder, file) : null;
  if (!full) return null;
  try {
    const bytes = fs.readFileSync(full);
    if (bytes.length > 256 * 1024) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export function inspect(folder: string): Inspection {
  const exists = fs.existsSync(folder) && fs.statSync(folder).isDirectory();
  const has = (file: string) => fs.existsSync(path.join(folder, file));
  const detected = exists ? detectProject(has, (file) => read(folder, file)) : { framework: null, label: "Missing folder", commands: [] as { label: string; command: string }[], healthUrl: null, envFiles: [], configFiles: [] };
  const rows = new Map<string, EnvRow>();
  for (const file of detected.envFiles) {
    for (const entry of parseEnv(read(folder, file) ?? "")) {
      const row = rows.get(entry.name) ?? { name: entry.name, set: false, files: [] };
      row.set ||= entry.set;
      row.files.push(file);
      rows.set(entry.name, row);
    }
  }
  const configRefs = detected.configFiles.flatMap((file) => springEnvRefs(read(folder, file) ?? ""));
  const envIgnored = gitignoreCovers(read(folder, ".gitignore"), WRITE_TO);
  const issues: string[] = [];
  if (rows.size && !envIgnored && has(WRITE_TO)) issues.push("Git doesn't ignore .env.local, so your keys could be committed. Add .env.local to .gitignore.");
  return { ...detected, folder, exists, env: [...rows.values()], configRefs: [...new Set(configRefs)], envIgnored, planFile: has(PLAN_FILE) || has(LEGACY_PLAN_FILE), issues, icon: exists ? findIcon(folder) : null, readme: exists ? readmeSummary(read(folder, "README.md") ?? read(folder, "readme.md")) : null };
}

/** Set one variable in the project's .env.local. The file is created readable only by you. */
export function writeEnv(folder: string, name: string, value: string): { created: boolean; ignored: boolean } {
  const file = path.join(folder, WRITE_TO);
  // A .env.local that links somewhere else would have the key written to wherever it points.
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(".env.local is a link to another file, so StackWise won't write to it.");
  const before = read(folder, WRITE_TO);
  fs.writeFileSync(file, setEnv(before ?? "", name, value), { mode: 0o600 });
  // The mode above only applies to a new file; an existing one is made private too.
  fs.chmodSync(file, 0o600);
  return { created: before === null, ignored: gitignoreCovers(read(folder, ".gitignore"), WRITE_TO) };
}
