import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SLOT_IDS } from "@/engine/schema";
import { sharedPlanSchema, type SharedPlan } from "@/engine/share";
import { AGENT_ID, agentName, type AgentState } from "./pairing";
import { LEGACY_STATE_DIR, STATE_DIR } from "@/engine/names";
import { migrateRepoState, stackwiseHome } from "@/local/home";

/**
 * Every plan on this computer, one JSON file each in `~/.stackwise/plans` (see src/local/home.ts),
 * so the app, the `stackwise` command and the MCP server all see the same plans. Each record has
 * the plan as agents read and change it (`plan`, with a version that goes up on every change) and
 * the parts only the app uses (`local`: the step, the canvas layout, the icon, the conversation).
 * The app saves here; Claude reads and changes `plan` through the MCP tools; the app polls and
 * shows what Claude did. Nothing here leaves the machine.
 */

export const PLAN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACTIVITY_LIMIT = 100;
const MESSAGE_LIMIT = 200;
export const MESSAGE_MAX = 4000;

export const activitySchema = z.object({
  id: z.string(),
  at: z.string(),
  tool: z.string(),
  summary: z.string(),
  changes: z.array(z.string()),
  verdict: z.string().optional(),
});
export type Activity = z.infer<typeof activitySchema>;

/** One message between the person and a coding agent, in either direction. */
export const messageSchema = z.object({
  id: z.string(),
  at: z.string(),
  from: z.enum(["you", "agent"]),
  /** Who it's for (from you) or who wrote it (from an agent). */
  agent: z.string().regex(AGENT_ID),
  text: z.string().max(MESSAGE_MAX),
  /** The part of the plan it's about. */
  about: z.enum(SLOT_IDS).optional(),
  /** The plan's version when the person wrote it, so the agent can tell if it changed since. */
  planVersion: z.number().int().min(0).optional(),
  /** Files the agent says it changed. */
  files: z.array(z.string().max(300)).max(50).optional(),
  status: z.enum(["working", "done", "needs_you"]).optional(),
  /** When the agent picked it up. */
  deliveredAt: z.string().optional(),
});
export type Message = z.infer<typeof messageSchema>;

export const agentStateSchema = z.object({
  id: z.string().regex(AGENT_ID),
  name: z.string().max(60),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  waitingSince: z.string().optional(),
  waitId: z.string().max(40).optional(),
  waitingUntil: z.string().optional(),
  activeAt: z.string(),
  stoppedAt: z.string().optional(),
  stopReason: z.enum(["idle"]).optional(),
  status: z.enum(["working", "done", "needs_you"]).optional(),
}) satisfies z.ZodType<AgentState>;

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
  /** The conversation with coding agents. Older files have none. */
  messages: z.array(messageSchema).default([]),
  /** Agents that have listened on this plan, by id. */
  agents: z.record(z.string(), agentStateSchema).default({}),
  /** The plan as it was when a project's stackwise.plan.json and this copy last agreed: the base for merging them. */
  synced: sharedPlanSchema.optional(),
  /** What only the app keeps: the step, the layout, the icon, the conversation. Agents never read it. */
  local: z.record(z.string(), z.unknown()).optional(),
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
  /** The person writes to one agent. Returns null when the plan isn't shared. */
  postMessage(id: string, message: Pick<Message, "agent" | "text" | "about" | "planVersion">): Message | null;
  /** Hands an agent the messages waiting for it, oldest first, and marks them delivered. */
  takeMessages(id: string, agent: string, at: string): Message[];
  /** An agent answers. */
  agentReply(id: string, message: Pick<Message, "agent" | "text" | "files" | "status">): Message | null;
  /** Remember the copy a project's plan file and this record both have, for the next merge. */
  setSynced(id: string, plan: SharedPlan): void;
  /** Updates what StackWise knows about an agent, creating it the first time it's seen. */
  updateAgent(id: string, agent: string, change: (current: AgentState) => AgentState, at: string): AgentState | null;
  /** Keeps the app's own part of a plan, without touching the shared plan or its version. */
  setLocal(id: string, local: Record<string, unknown>): PlanRecord | null;
  /** Deletes a plan's record. */
  remove(id: string): boolean;
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

/**
 * StackWise's old state folder in `root`, from before plans moved to the home folder. A folder
 * left from when StackWise was called WhyStack is renamed on first use.
 */
export function stateDir(root: string): string {
  const dir = path.join(root, STATE_DIR);
  const legacy = path.join(root, LEGACY_STATE_DIR);
  try {
    if (!fs.existsSync(dir) && fs.existsSync(legacy)) fs.renameSync(legacy, dir);
  } catch {
    // Another process renamed it first; the new folder is there either way.
  }
  return dir;
}

/** The registry in the home folder, after moving anything still in StackWise's own folder. */
export function homeRegistry(repoRoot: string): Registry {
  const home = stackwiseHome();
  stateDir(repoRoot);
  migrateRepoState(repoRoot, home);
  return createRegistry(home);
}

/** A registry whose files live directly in `dir`. */
export function createRegistry(dir: string): Registry {
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
        messages: previous?.messages ?? [],
        agents: previous?.agents ?? {},
        ...(previous?.synced ? { synced: previous.synced } : {}),
        ...(previous?.local ? { local: previous.local } : {}),
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
    postMessage(id, message) {
      const previous = read(id);
      if (!previous) return null;
      const at = laterThan(previous.touchedAt);
      const entry = messageSchema.parse({ ...message, id: randomUUID().slice(0, 12), at, from: "you", text: message.text.slice(0, MESSAGE_MAX) });
      writeAtomic(planFile(id), { ...previous, touchedAt: at, messages: [...previous.messages, entry].slice(-MESSAGE_LIMIT) });
      return entry;
    },
    takeMessages(id, agent, now) {
      const previous = read(id);
      if (!previous) return [];
      const waiting = previous.messages.filter((m) => m.from === "you" && m.agent === agent && !m.deliveredAt);
      if (waiting.length === 0) return [];
      const at = laterThan(previous.touchedAt);
      const ids = new Set(waiting.map((m) => m.id));
      const messages = previous.messages.map((m) => (ids.has(m.id) ? { ...m, deliveredAt: now } : m));
      const agents = previous.agents[agent] ? { ...previous.agents, [agent]: { ...previous.agents[agent], activeAt: now, lastSeenAt: now } } : previous.agents;
      writeAtomic(planFile(id), { ...previous, touchedAt: at, messages, agents });
      return waiting.map((m) => ({ ...m, deliveredAt: now }));
    },
    agentReply(id, message) {
      const previous = read(id);
      if (!previous) return null;
      const at = laterThan(previous.touchedAt);
      const entry = messageSchema.parse({ ...message, id: randomUUID().slice(0, 12), at, from: "agent", text: message.text.slice(0, MESSAGE_MAX) });
      const current = previous.agents[message.agent];
      const agents = current ? { ...previous.agents, [message.agent]: { ...current, lastSeenAt: at, activeAt: at, status: message.status } } : previous.agents;
      writeAtomic(planFile(id), { ...previous, touchedAt: at, messages: [...previous.messages, entry].slice(-MESSAGE_LIMIT), agents });
      return entry;
    },
    updateAgent(id, agent, change, now) {
      const previous = read(id);
      if (!previous) return null;
      const at = laterThan(previous.touchedAt);
      const current: AgentState = previous.agents[agent] ?? { id: agent, name: agentName(agent), firstSeenAt: now, lastSeenAt: now, activeAt: now };
      const next = agentStateSchema.parse(change(current));
      writeAtomic(planFile(id), { ...previous, touchedAt: at, agents: { ...previous.agents, [agent]: next } });
      return next;
    },
    setSynced(id, plan) {
      const previous = read(id);
      if (previous) writeAtomic(planFile(id), { ...previous, synced: sharedPlanSchema.parse(plan) });
    },
    setLocal(id, local) {
      const previous = read(id);
      if (!previous) return null;
      const record = { ...previous, local };
      writeAtomic(planFile(id), record);
      return record;
    },
    remove(id) {
      try {
        fs.rmSync(planFile(id));
        return true;
      } catch {
        return false;
      }
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
export const projectPlanFileSchema = z
  .object({
    stackwise: z.literal(1).optional(),
    /** Plan files written while StackWise was called WhyStack. */
    whystack: z.literal(1).optional(),
    id: z.string().regex(PLAN_ID),
    version: z.number().int().min(0),
    updatedAt: z.string(),
    plan: sharedPlanSchema,
  })
  .refine((file) => file.stackwise === 1 || file.whystack === 1, "not a StackWise plan file");
export type ProjectPlanFile = z.infer<typeof projectPlanFileSchema>;

export function toProjectPlanFile(record: Pick<PlanRecord, "id" | "version" | "updatedAt" | "plan">): ProjectPlanFile {
  return { stackwise: 1, id: record.id, version: record.version, updatedAt: record.updatedAt, plan: record.plan };
}
