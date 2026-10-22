import { DEFAULT_ANSWERER_KEY } from "./answerers";
import { mergeStores, toDiskLibrary, type DiskLibrary } from "./library";
import { initialStore, migrate, type History, type PlanState, type Store } from "./store";

/**
 * Where the applications live. The record is the library on disk (~/.stackwise, through
 * /api/library): it's what the `stackwise` command, the MCP server and a reinstalled browser all
 * read. This browser keeps a copy in localStorage so the app opens at once and keeps working if
 * the server is away for a moment; every save goes to both, and opening the app takes anything
 * newer from disk. The workspace and the projects page both go through here, so they always agree.
 */

export const STORE_KEY = "stackwise.store.v2";
const OLD_KEY = "stackwise.plan.v1";
const PUSH_DELAY_MS = 500;

export function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function loadHistory(): History {
  const now = new Date().toISOString();
  const id = newId();
  try {
    const saved = window.localStorage.getItem(STORE_KEY) ?? window.localStorage.getItem(OLD_KEY);
    const store = saved ? migrate(JSON.parse(saved), id, now) : null;
    if (store) return { store, past: [], future: [] };
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return { store: initialStore(id, now), past: [], future: [] };
}

let pushTimer = 0;
let pending: Store | null = null;
let lastPushed = "";
/**
 * Nothing goes to disk until this page has taken the library once. A fresh browser starts with a
 * blank plan and saves it a moment after it mounts; pushed before the pull came back, that blank
 * plan joined the library as one more "Untitled app". After the pull, what's pushed is the merge.
 */
let synced = false;

/** Writes the library to disk, a moment after the last change, and only when something changed. */
function push(store: Store) {
  if (!synced) return;
  pending = store;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    const body = JSON.stringify(toDiskLibrary(pending!));
    pending = null;
    if (body === lastPushed) return;
    lastPushed = body;
    void fetch("/api/library", { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {
      // The server is away: the browser's copy stands until it's back, and the next save tries again.
      lastPushed = "";
    });
  }, PUSH_DELAY_MS);
}

/** Saves and sends the store to disk right now, before a page change: a plan made on the Projects page has to be on disk before the canvas pulls the library. */
export async function flushStore(store: Store): Promise<void> {
  synced = true;
  saveStore(store);
  window.clearTimeout(pushTimer);
  pending = null;
  const body = JSON.stringify(toDiskLibrary(store));
  lastPushed = body;
  try {
    await fetch("/api/library", { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive: true });
  } catch {
    lastPushed = "";
  }
}

export function saveStore(store: Store): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    window.localStorage.removeItem(OLD_KEY);
  } catch {
    // Private windows and blocked storage: plans still work, they just won't survive a reload.
  }
  push(store);
}

/** The defaults the profile sets for a new plan, from the last time the library was read. */
let profileDefaults: Partial<Pick<PlanState, "size" | "priority" | "builderId">> = {};
export function planDefaults(): Partial<Pick<PlanState, "size" | "priority" | "builderId">> {
  return { ...profileDefaults };
}

/**
 * The library from disk, merged with what this browser has: the newer copy of each plan wins.
 * Null when the server can't be reached or nothing differs, so callers only replace the store
 * when there's something to take.
 */
export async function pullLibrary(current: Store): Promise<Store | null> {
  try {
    const response = await fetch("/api/library", { cache: "no-store" });
    if (!response.ok) return null;
    const disk = (await response.json()) as DiskLibrary & { profile?: { size: PlanState["size"]; priority: PlanState["priority"]; builderId: string; answerer?: string } };
    if (disk.profile) {
      profileDefaults = { size: disk.profile.size, priority: disk.profile.priority, builderId: disk.profile.builderId };
      // A browser that hasn't picked who answers in Ask starts with the profile's choice.
      try {
        if (disk.profile.answerer && !window.localStorage.getItem(DEFAULT_ANSWERER_KEY)) window.localStorage.setItem(DEFAULT_ANSWERER_KEY, disk.profile.answerer);
      } catch {
        // Private windows: nothing to seed.
      }
    }
    const merged = mergeStores(current, disk, new Date().toISOString());
    synced = true;
    // What this browser had and disk didn't goes to disk now, so a second browser or the command line sees it.
    if (JSON.stringify(toDiskLibrary(merged)) !== JSON.stringify({ activeId: disk.activeId, order: disk.order, plans: disk.plans.map((p) => ({ id: p.id, plan: p.plan, local: p.local })) })) push(merged);
    return JSON.stringify(merged) === JSON.stringify(current) ? null : merged;
  } catch {
    return null;
  }
}

/** The library the server rendered the page from, joined with this browser's copy; what only the browser had goes to disk. */
export function adoptLibrary(disk: DiskLibrary): Store {
  const merged = mergeStores(loadHistory().store, disk, new Date().toISOString());
  synced = true;
  if (JSON.stringify(toDiskLibrary(merged)) !== JSON.stringify({ activeId: disk.activeId, order: disk.order, plans: disk.plans.map((p) => ({ id: p.id, plan: p.plan, local: p.local })) })) push(merged);
  return merged;
}

/** Deleting a plan here deletes its record on disk too; the browser's copy goes through the reducer. */
export function deletePlanOnDisk(id: string): void {
  void fetch("/api/library", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => undefined);
}
