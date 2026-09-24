import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Node-only. Letting more than one coding agent work on a project at once without stepping on
 * each other: each gets its own git worktree (a second checkout of the same repo, in a sibling
 * folder, on its own branch), and StackWise shows what each changed and merges a branch back when
 * the person asks. git runs without a shell, one argument at a time. Nothing is ever forced: a
 * merge needs a clean main checkout and is backed out on conflict, and a worktree with
 * uncommitted work isn't removed.
 */

export const BRANCH_PREFIX = "stackwise/";

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  /** The folder the person linked, as opposed to an agent's copy. */
  main: boolean;
  /** For an agent's copy: the agent it belongs to, from the branch name. */
  agent: string | null;
}

export interface Changes {
  /** Files changed and not yet committed. */
  uncommitted: string[];
  /** Commits on this branch that the base branch doesn't have. */
  ahead: number;
  /** Files those commits change. */
  committed: string[];
}

function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    // A linked folder may have come from anywhere: its own hooks and fsmonitor settings never run.
    execFile("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, out: stdout.toString(), err: stderr.toString() }));
  });
}

/** Parse `git worktree list --porcelain`. */
export function parseWorktrees(porcelain: string, mainPath: string): Worktree[] {
  return porcelain
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const line = (key: string) => block.split("\n").find((l) => l.startsWith(`${key} `))?.slice(key.length + 1) ?? null;
      const branch = line("branch")?.replace(/^refs\/heads\//, "") ?? null;
      const wtPath = line("worktree") ?? "";
      return {
        path: wtPath,
        branch,
        head: (line("HEAD") ?? "").slice(0, 12),
        // Paths in someone's project, not files the app ships with: the build's file tracing skips them.
        main: path.resolve(/* turbopackIgnore: true */ wtPath) === path.resolve(/* turbopackIgnore: true */ mainPath),
        agent: branch?.startsWith(BRANCH_PREFIX) ? branch.slice(BRANCH_PREFIX.length) : null,
      };
    });
}

/** Parse `git status --porcelain` into file paths. */
export function parseStatus(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.slice(3).replace(/^.* -> /, ""));
}

/** Where an agent's copy goes: a sibling of the project folder, named after it. */
export function worktreePath(folder: string, agent: string): string {
  return `${folder.replace(/\/+$/, "")}-${agent}`;
}

export async function repoInfo(folder: string): Promise<{ repo: boolean; branch: string | null; clean: boolean; worktrees: Worktree[] }> {
  const inside = await git(folder, ["rev-parse", "--show-toplevel"]);
  if (!inside.ok) return { repo: false, branch: null, clean: false, worktrees: [] };
  const [branch, status, list] = await Promise.all([git(folder, ["branch", "--show-current"]), git(folder, ["status", "--porcelain"]), git(folder, ["worktree", "list", "--porcelain"])]);
  return { repo: true, branch: branch.out.trim() || null, clean: parseStatus(status.out).length === 0, worktrees: parseWorktrees(list.out, folder) };
}

export async function changes(worktree: string, base: string): Promise<Changes> {
  const [status, ahead, files] = await Promise.all([
    git(worktree, ["status", "--porcelain"]),
    git(worktree, ["rev-list", "--count", `${base}..HEAD`]),
    git(worktree, ["diff", "--name-only", `${base}...HEAD`]),
  ]);
  return { uncommitted: parseStatus(status.out), ahead: Number(ahead.out.trim()) || 0, committed: files.out.split("\n").filter(Boolean) };
}

/** Give an agent its own checkout on its own branch, from the project's current commit. */
export async function addWorktree(folder: string, agent: string): Promise<{ path: string; branch: string } | { error: string }> {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(agent)) return { error: "Name the agent with letters, numbers and dashes." };
  const target = worktreePath(folder, agent);
  if (fs.existsSync(target)) return { error: `${target} already exists.` };
  const branch = `${BRANCH_PREFIX}${agent}`;
  const added = await git(folder, ["worktree", "add", "-b", branch, target]);
  return added.ok ? { path: target, branch } : { error: added.err.trim() || "git couldn't add the worktree." };
}

/** Merge an agent's branch into the project's current branch, or back out and say which files clash. */
export async function mergeBranch(folder: string, branch: string): Promise<{ merged: true; summary: string } | { error: string; conflicts?: string[] }> {
  if (!branch.startsWith(BRANCH_PREFIX)) return { error: "StackWise only merges the branches it made for agents." };
  const status = await git(folder, ["status", "--porcelain"]);
  if (parseStatus(status.out).length) return { error: "Your main copy has uncommitted changes. Commit or stash them first, so a merge can't mix with them." };
  const merged = await git(folder, ["merge", "--no-ff", "--no-edit", branch]);
  if (merged.ok) return { merged: true, summary: merged.out.trim().split("\n").slice(-1)[0] ?? "Merged." };
  const conflicts = await git(folder, ["diff", "--name-only", "--diff-filter=U"]);
  await git(folder, ["merge", "--abort"]);
  return { error: "The branches changed the same lines, so StackWise backed the merge out. Nothing changed in your main copy.", conflicts: conflicts.out.split("\n").filter(Boolean) };
}

/** Remove an agent's checkout. Refuses when it has uncommitted work. The branch stays, so nothing is lost. */
export async function removeWorktree(folder: string, worktree: string): Promise<{ removed: true } | { error: string }> {
  const removed = await git(folder, ["worktree", "remove", worktree]);
  return removed.ok ? { removed: true } : { error: removed.err.trim() || "git couldn't remove it. Commit or discard its changes first." };
}
