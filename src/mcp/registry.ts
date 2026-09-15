import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { sharedPlanSchema, type SharedPlan } from "@/engine/share";

/**
 * Plans shared between WhyStack's browser tab and Claude, kept as small JSON files in
 * `.whystack/` (gitignored) so the app's server and the command-line MCP server both see them.
 * The browser shares the plan you have open; Claude reads and changes it through the MCP tools;
 * the browser polls and shows what Claude did. Nothing here leaves the machine.
 */

export const PLAN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACTIVITY_LIMIT = 100;

export const activitySchema = z.object({
  id: z.string(),
  at: z.string(),
  tool: z.string(),
  summary: z.string(),
  changes: z.array(z.string()),
  verdict: z.string().optional(),
});
export type Activity = z.infer<typeof activitySchema>;

export const planRecordSchema = z.object({
  id: z.string().regex(PLAN_ID),
  /** Goes up when the plan itself changes. */
  version: z.number().int().min(0),
  updatedAt: z.string(),
  updatedBy: z.enum(["browser", "claude"]),
  /** Goes up on any change, including new activity, so the browser knows when to look. */
  touchedAt: z.string(),
  plan: sharedPlanSchema,
  activity: z.array(activitySchema),
});
export type PlanRecord = z.infer<typeof planRecordSchema>;

export interface Registry {
  dir: string;
  read(id: string): PlanRecord | null;
  list(): PlanRecord[];
  /** Save a new version of the plan. Returns the saved record. */
  savePlan(id: string, plan: SharedPlan, by: PlanRecord["updatedBy"], activity?: Omit<Activity, "id" | "at">): PlanRecord;
  addActivity(id: string, activity: Omit<Activity, "id" | "at">): PlanRecord | null;
  activeId(): string | null;
  setActive(id: string | null): void;
}

function writeAtomic(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temp, file);
}

/** A timestamp that always moves forward, even for two writes in the same millisecond. */
function laterThan(previous: string | undefined): string {
  const now = Date.now();
  const last = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, last + 1)).toISOString();
}

export function createRegistry(root: string): Registry {
  const dir = path.join(root, ".whystack");
  const planFile = (id: string) => {
    if (!PLAN_ID.test(id)) throw new Error(`"${id}" isn't a valid plan id`);
    return path.join(dir, "plans", `${id}.json`);
  };
  const activeFile = path.join(dir, "active.json");

  const read = (id: string): PlanRecord | null => {
    try {
      const parsed = planRecordSchema.safeParse(JSON.parse(fs.readFileSync(planFile(id), "utf8")));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  const withActivity = (activity: Activity[], entry: Omit<Activity, "id" | "at"> | undefined, at: string) =>
    entry ? [...activity, { ...entry, id: randomUUID().slice(0, 12), at }].slice(-ACTIVITY_LIMIT) : activity;

  return {
    dir,
    read,
    list() {
      try {
        return fs
          .readdirSync(path.join(dir, "plans"))
          .filter((f) => f.endsWith(".json"))
          .flatMap((f) => {
            const record = read(f.slice(0, -5));
            return record ? [record] : [];
          });
      } catch {
        return [];
      }
    },
    savePlan(id, plan, by, activity) {
      const previous = read(id);
      const at = laterThan(previous?.touchedAt);
      const unchanged = previous && JSON.stringify(previous.plan) === JSON.stringify(plan);
      const record: PlanRecord = {
        id,
        version: unchanged ? previous.version : (previous?.version ?? 0) + 1,
        updatedAt: unchanged ? previous.updatedAt : at,
        updatedBy: unchanged ? previous.updatedBy : by,
        touchedAt: at,
        plan: sharedPlanSchema.parse(plan),
        activity: withActivity(previous?.activity ?? [], activity, at),
      };
      writeAtomic(planFile(id), record);
      return record;
    },
    addActivity(id, activity) {
      const previous = read(id);
      if (!previous) return null;
      const at = laterThan(previous.touchedAt);
      const record = { ...previous, touchedAt: at, activity: withActivity(previous.activity, activity, at) };
      writeAtomic(planFile(id), record);
      return record;
    },
    activeId() {
      try {
        const saved = JSON.parse(fs.readFileSync(activeFile, "utf8")) as { id?: unknown };
        return typeof saved.id === "string" && PLAN_ID.test(saved.id) ? saved.id : null;
      } catch {
        return null;
      }
    },
    setActive(id) {
      if (id === null) fs.rmSync(activeFile, { force: true });
      else writeAtomic(activeFile, { id, at: new Date().toISOString() });
    },
  };
}

/** The file an exported project keeps its plan in, so the stack's record travels with the code. */
export const projectPlanFileSchema = z.object({
  whystack: z.literal(1),
  id: z.string().regex(PLAN_ID),
  version: z.number().int().min(0),
  updatedAt: z.string(),
  plan: sharedPlanSchema,
});
export type ProjectPlanFile = z.infer<typeof projectPlanFileSchema>;

export function toProjectPlanFile(record: Pick<PlanRecord, "id" | "version" | "updatedAt" | "plan">): ProjectPlanFile {
  return { whystack: 1, id: record.id, version: record.version, updatedAt: record.updatedAt, plan: record.plan };
}
