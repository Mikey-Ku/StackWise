import path from "node:path";
import type { SpecFile } from "@/engine";

/**
 * Writing a project into a folder on this computer. The rules live here, away from the file
 * system, so they can be tested: which folders StackWise will write into, and which files it
 * refuses to write over. `.env.local` is the one it never replaces, because that's where the
 * person's real keys are, and StackWise has no copy of them.
 */

/** Folders under home that aren't places for a project. */
const OFF_LIMITS = new Set(["Library", "Applications", "System", "Pictures", "Movies", "Music", "node_modules"]);

export const NEVER_REPLACE = ".env.local";

export function expandHome(input: string, home: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return home;
  return trimmed.startsWith("~/") ? path.join(home, trimmed.slice(2)) : trimmed;
}

/** The folder StackWise will write into, or the reason it won't. */
export function resolveFolder(input: string, home: string, stackwiseRoot: string): { path: string } | { error: string } {
  if (!input.trim()) return { error: "Type a folder, like ~/code/my-app." };
  if (input.includes("\0")) return { error: "That isn't a folder name." };
  const expanded = expandHome(input, home);
  if (!path.isAbsolute(expanded)) return { error: "Use a full path, like ~/code/my-app or /Users/you/code/my-app." };
  const target = path.resolve(expanded);
  const inside = (parent: string) => {
    const relative = path.relative(parent, target);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  if (target === home) return { error: "Pick a folder inside your home folder, not the home folder itself." };
  if (!inside(home)) return { error: `StackWise only writes inside your home folder (${home}).` };
  if (target === stackwiseRoot || inside(stackwiseRoot)) return { error: "That's StackWise's own folder. Pick somewhere else for your project." };
  const segments = path.relative(home, target).split(path.sep);
  const bad = segments.find((segment) => OFF_LIMITS.has(segment) || segment.startsWith("."));
  if (bad) return { error: `"${bad}" isn't a place for a project. Pick a plain folder, like ~/code/my-app.` };
  return { path: target };
}

export interface KeptFile {
  name: string;
  why: string;
}

/**
 * What to write and what to leave alone. Nothing is replaced unless the person asked for it, and
 * `.env.local` is never replaced at all.
 */
export function planWrites(files: SpecFile[], exists: (name: string) => boolean, replace: boolean): { write: SpecFile[]; keep: KeptFile[] } {
  const write: SpecFile[] = [];
  const keep: KeptFile[] = [];
  for (const file of files) {
    if (!exists(file.name)) {
      write.push(file);
      continue;
    }
    if (file.name === NEVER_REPLACE) keep.push({ name: file.name, why: "It's already there, and your real values live in it. StackWise never writes over it." });
    else if (!replace) keep.push({ name: file.name, why: "It's already there. Tick “Replace files that are already there” to update it." });
    else write.push(file);
  }
  return { write, keep };
}

/** Variables the plan needs that an existing `.env.local` doesn't name yet. */
export function missingEnvNames(names: string[], envLocal: string | null): string[] {
  if (envLocal === null) return [];
  const have = new Set(
    envLocal
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0].replace(/^export\s+/, "").trim()),
  );
  return names.filter((name) => !have.has(name));
}
