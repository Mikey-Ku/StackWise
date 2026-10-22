import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { PRIORITY_IDS, SIZE_IDS } from "@/engine/schema";
import { setting } from "@/engine/names";

/**
 * Node-only. Where StackWise keeps your things on this computer: `~/.stackwise` (or
 * STACKWISE_HOME). Your profile, the library of every plan, the plans shared with coding agents,
 * and the server's log and pid all live here, so the app, the `stackwise` command and the MCP
 * server see the same plans whichever folder they run from. A plan linked to a project also
 * lives in that project as stackwise.plan.json, so the record travels with the code.
 */

export function stackwiseHome(env: Record<string, string | undefined> = process.env, home = os.homedir()): string {
  return setting("HOME", env) || path.join(home, ".stackwise");
}

export const profileSchema = z.object({
  /** How StackWise greets you. Left empty, it uses your account name. */
  name: z.string().max(80).default(""),
  /** Defaults for a new plan. */
  builderId: z.string().regex(/^[a-z0-9-]*$/).max(40).default("claude-code"),
  priority: z.enum(PRIORITY_IDS).default("spend_zero"),
  size: z.enum(SIZE_IDS).default("up_to_100"),
  /** Who answers in Ask by default ("agent:claude-code", "api:claude", "facts"). */
  answerer: z.string().max(60).default(""),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  /** Folders StackWise looks in for projects, with ~ for your home folder. */
  folders: z.array(z.string().max(1024)).max(20).default(["~/Projects"]),
});
export type Profile = z.infer<typeof profileSchema>;

export const DEFAULT_PROFILE: Profile = profileSchema.parse({});

/** The name on the account running StackWise, for the first greeting. */
export function accountName(): string {
  try {
    const info = os.userInfo();
    return info.username.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "";
  }
}

function writeAtomic(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function readProfile(dir: string): Profile {
  try {
    const parsed = profileSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, "profile.json"), "utf8")));
    return parsed.success ? parsed.data : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

/** Change some of the profile. Unknown fields are dropped, bad values keep the old ones. */
export function writeProfile(dir: string, patch: Partial<Profile>): Profile {
  const next = profileSchema.parse({ ...readProfile(dir), ...patch });
  writeAtomic(path.join(dir, "profile.json"), next);
  return next;
}

/** Which plan is open and in what order they're listed. The plans themselves are the registry's records. */
export const libraryIndexSchema = z.object({
  activeId: z.string().max(64).nullable().default(null),
  order: z.array(z.string().max(64)).max(500).default([]),
});
export type LibraryIndex = z.infer<typeof libraryIndexSchema>;

export function readLibraryIndex(dir: string): LibraryIndex {
  try {
    const parsed = libraryIndexSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, "library.json"), "utf8")));
    return parsed.success ? parsed.data : { activeId: null, order: [] };
  } catch {
    return { activeId: null, order: [] };
  }
}

export function writeLibraryIndex(dir: string, index: LibraryIndex): void {
  writeAtomic(path.join(dir, "library.json"), libraryIndexSchema.parse(index));
}

/**
 * Plans shared before v1 lived in StackWise's own folder (`<repo>/.stackwise`). The first run
 * with a home folder moves them over, so agent conversations and shared plans carry on.
 */
export function migrateRepoState(repoRoot: string, home: string): string[] {
  const moved: string[] = [];
  const old = path.join(repoRoot, ".stackwise");
  if (path.resolve(old) === path.resolve(home)) return moved;
  try {
    const oldPlans = path.join(old, "plans");
    if (!fs.existsSync(oldPlans)) return moved;
    fs.mkdirSync(path.join(home, "plans"), { recursive: true });
    for (const name of fs.readdirSync(oldPlans)) {
      if (!name.endsWith(".json")) continue;
      const target = path.join(home, "plans", name);
      if (fs.existsSync(target)) continue;
      fs.copyFileSync(path.join(oldPlans, name), target);
      moved.push(name.slice(0, -5));
    }
    const active = path.join(old, "active.json");
    if (fs.existsSync(active) && !fs.existsSync(path.join(home, "active.json"))) fs.copyFileSync(active, path.join(home, "active.json"));
    // The old folder is kept, only renamed, in case anything still points there.
    fs.renameSync(oldPlans, `${oldPlans}.moved`);
  } catch {
    // A plan that couldn't be moved stays where it was; nothing is deleted.
  }
  return moved;
}
