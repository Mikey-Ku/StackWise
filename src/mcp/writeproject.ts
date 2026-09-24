import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SpecFile } from "@/engine";
import { missingEnvNames, NEVER_REPLACE, planWrites, resolveFolder, type KeptFile } from "./localfiles";

/**
 * Node-only. Writing a project pack into a folder, for the Export dialog (/api/local) and for
 * agents (export_project), under the same rules in localfiles.ts: inside the home folder, never
 * StackWise's own folder, nothing replaced unless asked, and `.env.local` never replaced.
 */

export interface WriteReport {
  path: string;
  folderExists: boolean;
  write: string[];
  keep: KeptFile[];
  missingEnv: string[];
  wrote: string[];
}

/** The main checkout when `root` is a git worktree of it: that's StackWise's folder too. */
export function mainCheckout(root: string): string | null {
  try {
    const dotGit = path.join(root, ".git");
    if (!fs.lstatSync(dotGit).isFile()) return null;
    const gitdir = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
    const at = gitdir?.lastIndexOf(`${path.sep}.git${path.sep}worktrees${path.sep}`) ?? -1;
    return gitdir && at > 0 ? gitdir.slice(0, at) : null;
  } catch {
    return null;
  }
}

/** A path with its existing part resolved through symlinks, so a link can't point the checks somewhere else. */
function realTarget(target: string): string {
  let existing = target;
  const rest: string[] = [];
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return path.join(fs.realpathSync(existing), ...rest);
}

/**
 * The folder StackWise will work in, checked twice: as typed, and again after following symlinks,
 * against the real home folder and every copy of StackWise (a worktree and its main checkout).
 */
export function resolveRealFolder(input: string, stackwiseRoot: string, home = os.homedir()): { path: string } | { error: string } {
  const roots = [stackwiseRoot, mainCheckout(stackwiseRoot)].filter((root): root is string => Boolean(root));
  const typed = resolveFolder(input, home, roots);
  if ("error" in typed) return typed;
  try {
    const realRoots = roots.map((root) => (fs.existsSync(root) ? fs.realpathSync(root) : root));
    return resolveFolder(realTarget(typed.path), fs.realpathSync(home), realRoots);
  } catch {
    return { error: "StackWise couldn't read that folder." };
  }
}

/** True when some folder or file on the way to `name` inside `folder` is a symlink. */
function throughLink(folder: string, name: string): boolean {
  let at = folder;
  for (const part of name.split("/")) {
    at = path.join(at, part);
    try {
      if (fs.lstatSync(at).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function writeProjectFolder(
  input: string,
  files: SpecFile[],
  options: { stackwiseRoot: string; envNames: string[]; replace?: boolean; dryRun?: boolean; home?: string },
): WriteReport | { error: string } {
  const folder = resolveRealFolder(input, options.stackwiseRoot, options.home);
  if ("error" in folder) return folder;
  const exists = (name: string) => fs.existsSync(path.join(folder.path, name));
  const planned = planWrites(files, exists, options.replace ?? false);
  // Never write through a symlink: it could point anywhere on the computer.
  const write = planned.write.filter((file) => !throughLink(folder.path, file.name));
  const keep = [...planned.keep, ...planned.write.filter((file) => !write.includes(file)).map((file) => ({ name: file.name, why: "It's a link to somewhere else, so StackWise leaves it alone." }))];
  let envLocal: string | null = null;
  try {
    envLocal = fs.readFileSync(path.join(folder.path, NEVER_REPLACE), "utf8");
  } catch {
    // No .env.local yet: nothing can be missing from it.
  }
  const report = { path: folder.path, folderExists: fs.existsSync(folder.path), write: write.map((f) => f.name), keep, missingEnv: missingEnvNames(options.envNames, envLocal), wrote: [] as string[] };
  if (options.dryRun) return report;
  try {
    for (const file of write) {
      const target = path.join(folder.path, file.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, file.name === NEVER_REPLACE ? { mode: 0o600 } : undefined);
      if (file.name === NEVER_REPLACE) fs.chmodSync(target, 0o600);
    }
  } catch (error) {
    return { error: `Couldn't write there: ${(error as Error).message}` };
  }
  return { ...report, folderExists: true, wrote: report.write };
}
