import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addWorktree, changes, mergeBranch, parseStatus, parseWorktrees, removeWorktree, repoInfo, worktreePath } from "./git";

const dirs: string[] = [];
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

/** A throwaway repo with one commit on main. */
function repo(): string {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stackwise-git-")));
  dirs.push(parent);
  const dir = path.join(parent, "app");
  fs.mkdirSync(dir);
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "test@example.com");
  sh(dir, "config", "user.name", "Test");
  fs.writeFileSync(path.join(dir, "app.txt"), "line one\nline two\n");
  sh(dir, "add", ".");
  sh(dir, "commit", "-q", "-m", "start");
  return dir;
}

afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("agents in their own worktrees", () => {
  it("reads git's porcelain output", () => {
    const list = "worktree /p/app\nHEAD abcdef1234567890\nbranch refs/heads/main\n\nworktree /p/app-codex\nHEAD 1234567890abcdef\nbranch refs/heads/stackwise/codex\n";
    expect(parseWorktrees(list, "/p/app")).toEqual([
      { path: "/p/app", branch: "main", head: "abcdef123456", main: true, agent: null },
      { path: "/p/app-codex", branch: "stackwise/codex", head: "1234567890ab", main: false, agent: "codex" },
    ]);
    expect(parseStatus(" M src/a.ts\n?? new.txt\nR  old.ts -> renamed.ts\n")).toEqual(["src/a.ts", "new.txt", "renamed.ts"]);
    expect(worktreePath("/p/app/", "codex")).toBe("/p/app-codex");
  });

  it("gives an agent its own copy, shows what it changed, and merges it back", async () => {
    const dir = repo();
    const added = await addWorktree(dir, "codex");
    if ("error" in added) throw new Error(added.error);
    expect(added).toEqual({ path: `${dir}-codex`, branch: "stackwise/codex" });
    expect(await addWorktree(dir, "codex")).toMatchObject({ error: expect.stringContaining("already exists") });
    expect(await addWorktree(dir, "Bad Name")).toMatchObject({ error: expect.any(String) });

    fs.writeFileSync(path.join(added.path, "feature.txt"), "new\n");
    expect((await changes(added.path, "main")).uncommitted).toEqual(["feature.txt"]);
    sh(added.path, "add", ".");
    sh(added.path, "commit", "-q", "-m", "feature");
    expect(await changes(added.path, "main")).toEqual({ uncommitted: [], ahead: 1, committed: ["feature.txt"] });

    const info = await repoInfo(dir);
    expect(info).toMatchObject({ repo: true, branch: "main", clean: true });
    expect(info.worktrees.map((w) => w.agent)).toEqual([null, "codex"]);

    expect(await mergeBranch(dir, "stackwise/codex")).toMatchObject({ merged: true });
    expect(fs.existsSync(path.join(dir, "feature.txt"))).toBe(true);
    expect(await removeWorktree(dir, added.path)).toEqual({ removed: true });
  });

  it("backs a conflicting merge out, names the files, and leaves the main copy as it was", async () => {
    const dir = repo();
    const added = await addWorktree(dir, "claude-code");
    if ("error" in added) throw new Error(added.error);
    fs.writeFileSync(path.join(added.path, "app.txt"), "line one\nagent's line\n");
    sh(added.path, "commit", "-q", "-am", "agent");
    fs.writeFileSync(path.join(dir, "app.txt"), "line one\nmy line\n");
    expect(await mergeBranch(dir, "stackwise/claude-code")).toMatchObject({ error: expect.stringContaining("uncommitted") });
    sh(dir, "commit", "-q", "-am", "mine");

    const result = await mergeBranch(dir, "stackwise/claude-code");
    expect(result).toMatchObject({ conflicts: ["app.txt"] });
    expect(fs.readFileSync(path.join(dir, "app.txt"), "utf8")).toBe("line one\nmy line\n");
    expect((await repoInfo(dir)).clean).toBe(true);
    expect(await mergeBranch(dir, "main")).toMatchObject({ error: expect.stringContaining("only merges") });

    fs.writeFileSync(path.join(added.path, "wip.txt"), "unsaved\n");
    expect(await removeWorktree(dir, added.path)).toMatchObject({ error: expect.any(String) });
  });
});
