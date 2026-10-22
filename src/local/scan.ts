import { detectProject } from "@/project/detect";
import { LEGACY_PLAN_FILE, PLAN_FILE } from "@/engine/names";

/**
 * Finding your projects: every folder one level under the folders in your profile, with what
 * StackWise can tell about each one. Pure: the caller hands in the file system, so the rules are
 * tested without one.
 */

export interface ScanFs {
  /** Names of the entries in a folder that are folders themselves. */
  folders(dir: string): string[];
  exists(file: string): boolean;
  read(file: string): string | null;
}

export interface FoundProject {
  /** The full path. */
  path: string;
  /** The folder's name. */
  name: string;
  /** A StackWise framework option id, when one is recognized. */
  framework: string | null;
  /** What it looks like, in words ("Next.js", "Spring Boot"). */
  label: string;
  /** The plan file in it, when it has one. */
  plan: { id: string; appName: string } | null;
}

/** Folders nobody wants listed as projects. */
const SKIP = new Set(["node_modules", "dist", "build", "target", "tmp", "temp"]);

function readPlan(fsx: ScanFs, dir: string): FoundProject["plan"] {
  for (const name of [PLAN_FILE, LEGACY_PLAN_FILE]) {
    const text = fsx.read(`${dir}/${name}`);
    if (!text) continue;
    try {
      const raw = JSON.parse(text) as { id?: unknown; plan?: { appName?: unknown } };
      if (typeof raw.id === "string") return { id: raw.id, appName: typeof raw.plan?.appName === "string" ? raw.plan.appName : "" };
    } catch {
      // A broken plan file isn't a plan.
    }
  }
  return null;
}

/** The projects one level under `root`: anything with a plan file, or anything StackWise recognizes as an app. */
export function scanFolder(fsx: ScanFs, root: string, limit = 200): FoundProject[] {
  const found: FoundProject[] = [];
  for (const name of fsx.folders(root).sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith(".") || SKIP.has(name)) continue;
    const dir = `${root}/${name}`;
    const plan = readPlan(fsx, dir);
    const detected = detectProject((file) => fsx.exists(`${dir}/${file}`), (file) => fsx.read(`${dir}/${file}`));
    if (!plan && !detected.framework && detected.label === "Unknown project") continue;
    found.push({ path: dir, name, framework: detected.framework, label: detected.label, plan });
    if (found.length >= limit) break;
  }
  return found;
}
