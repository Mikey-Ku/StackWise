import type { SharedPlan } from "@/engine";
import { blankPlan, toSharedPlan, type PlanState, type Store } from "./store";

/**
 * The library on disk (~/.stackwise, through /api/library) and the store in this browser, kept
 * level. Disk is the record: it's what the `stackwise` command, the MCP server and a reinstalled
 * browser all read. The browser keeps a copy so the app opens at once and keeps working if the
 * server is away for a moment. Pure functions, tested without either.
 */

/** The part of a plan only the app uses, kept beside the shared plan in its record. */
export interface LocalState {
  step: PlanState["step"];
  createdAt: string;
  updatedAt: string;
  layout: PlanState["layout"];
  checked: PlanState["checked"];
  guesses: PlanState["guesses"];
  chat: PlanState["chat"];
  icon?: string;
  folder?: string;
}

export interface DiskPlan {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy: "browser" | "claude";
  plan: SharedPlan;
  local: LocalState | null;
}

export interface DiskLibrary {
  activeId: string | null;
  order: string[];
  plans: DiskPlan[];
}

/** A plan as the library stores it: what agents share, and what only the app keeps. */
export function splitPlan(plan: PlanState): { id: string; plan: SharedPlan; local: LocalState } {
  const { step, createdAt, updatedAt, layout, checked, guesses, chat, icon, folder } = plan;
  return { id: plan.id, plan: toSharedPlan(plan), local: { step, createdAt, updatedAt, layout, checked, guesses, chat, ...(icon ? { icon } : {}), ...(folder ? { folder } : {}) } };
}

/** A record from disk as a plan in the store, over what the browser already had of it. */
export function joinPlan(record: DiskPlan, base: PlanState | undefined, now: string): PlanState {
  const start = base ?? { ...blankPlan(record.id, record.local?.createdAt ?? now), step: "plan" as const };
  const shared = record.plan;
  const local = record.local;
  const plan: PlanState = {
    ...start,
    id: record.id,
    appName: shared.appName,
    description: shared.description,
    features: shared.features,
    answers: shared.answers,
    size: shared.size,
    priority: shared.priority,
    builderId: shared.builderId,
    pinned: shared.pinned,
    notes: shared.notes,
    custom: shared.custom ?? {},
    extras: shared.extras ?? {},
    links: shared.links ?? {},
    ...(local ? { step: local.step, createdAt: local.createdAt, layout: local.layout, checked: local.checked, guesses: local.guesses, chat: local.chat, icon: local.icon, folder: local.folder } : {}),
    updatedAt: newest(record),
  };
  if (!plan.icon) delete plan.icon;
  if (!plan.folder) delete plan.folder;
  // An agent answered a question the person had only guessed at: the answer stands.
  plan.guesses = Object.fromEntries(Object.entries(plan.guesses).filter(([needId]) => !(needId in plan.answers) || needId in (local?.guesses ?? {})));
  return plan;
}

/** When a record last changed, whichever side changed it. */
export function newest(record: DiskPlan): string {
  const local = record.local?.updatedAt ?? "";
  return local > record.updatedAt ? local : record.updatedAt;
}

/**
 * Both copies of every plan, the newer one winning plan by plan. A plan only on disk comes in; a
 * plan only in the browser stays (and is written to disk on the next save). The open plan stays
 * open when it still exists.
 */
export function mergeStores(local: Store, disk: DiskLibrary, now: string): Store {
  const plans: Record<string, PlanState> = { ...local.plans };
  for (const record of disk.plans) {
    const mine = plans[record.id];
    if (!mine || newest(record) > mine.updatedAt) plans[record.id] = joinPlan(record, mine, now);
  }
  const ids = Object.keys(plans);
  const order = [...disk.order, ...local.order, ...ids].filter((id, i, all) => plans[id] && all.indexOf(id) === i);
  const activeId = plans[local.activeId] ? local.activeId : disk.activeId && plans[disk.activeId] ? disk.activeId : order[0];
  return { version: 2, activeId, order, plans };
}

/** The changes to send to disk: every plan, split, plus which is open and the order. */
export function toDiskLibrary(store: Store): { activeId: string; order: string[]; plans: ReturnType<typeof splitPlan>[] } {
  return { activeId: store.activeId, order: store.order, plans: store.order.filter((id) => store.plans[id]).map((id) => splitPlan(store.plans[id])) };
}
