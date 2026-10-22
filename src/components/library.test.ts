import { describe, expect, it } from "vitest";
import { joinPlan, mergeStores, splitPlan, toDiskLibrary, type DiskPlan } from "./library";
import { blankPlan, initialStore, reduce, type Store } from "./store";

const t0 = "2026-10-20T10:00:00.000Z";
const t1 = "2026-10-21T10:00:00.000Z";
const t2 = "2026-10-22T10:00:00.000Z";

function planned(id: string, name: string, at: string) {
  return { ...blankPlan(id, t0), step: "plan" as const, appName: name, updatedAt: at, layout: { app: { x: 1, y: 2 } }, chat: [{ id: "c1", role: "you" as const, text: "hi", at, about: "framework" as const }] };
}
const store = (plans: ReturnType<typeof planned>[], activeId = plans[0].id): Store => ({ version: 2, activeId, order: plans.map((p) => p.id), plans: Object.fromEntries(plans.map((p) => [p.id, p])) });
const record = (plan: ReturnType<typeof planned>, over: Partial<DiskPlan> = {}): DiskPlan => {
  const split = splitPlan(plan);
  return { id: plan.id, version: 1, updatedAt: plan.updatedAt, updatedBy: "browser", plan: split.plan, local: split.local, ...over };
};

describe("the library and the browser", () => {
  it("splits a plan into what agents share and what only the app keeps, and joins it back whole", () => {
    const plan = { ...planned("a1", "Fade", t1), icon: "data:image/png;base64,AAA", folder: "~/Projects/fade" };
    const split = splitPlan(plan);
    expect(Object.keys(split.plan)).not.toContain("layout");
    expect(split.local).toMatchObject({ step: "plan", layout: { app: { x: 1, y: 2 } }, icon: "data:image/png;base64,AAA", folder: "~/Projects/fade" });
    expect(joinPlan({ ...record(plan), local: split.local }, undefined, t2)).toEqual(plan);
  });

  it("takes the newer copy of each plan, keeps plans only one side has, and leaves the open plan open", () => {
    const browser = store([planned("a1", "Fade, edited here", t2), planned("b2", "Only here", t1)], "b2");
    const disk = { activeId: "a1", order: ["c3", "a1"], plans: [record(planned("a1", "Fade, old on disk", t1)), record(planned("c3", "Only on disk", t0))] };
    const merged = mergeStores(browser, disk, t2);
    expect(merged.plans.a1.appName).toBe("Fade, edited here");
    expect(merged.plans.c3.appName).toBe("Only on disk");
    expect(merged.plans.b2.appName).toBe("Only here");
    expect(merged.order).toEqual(["c3", "a1", "b2"]);
    expect(merged.activeId).toBe("b2");
  });

  it("takes an agent's change from disk over an older browser copy, keeping the browser's layout and chat", () => {
    const mine = planned("a1", "Fade", t1);
    const agentEdit = record(planned("a1", "Fade", t0), { updatedAt: t2, updatedBy: "claude", local: null, plan: { ...splitPlan(mine).plan, appName: "Fade", notes: { payments: { text: "Deposits only.", updatedAt: t2, by: "claude" } } } });
    const merged = mergeStores(store([mine]), { activeId: null, order: [], plans: [agentEdit] }, t2);
    expect(merged.plans.a1.notes.payments?.text).toBe("Deposits only.");
    expect(merged.plans.a1.layout).toEqual({ app: { x: 1, y: 2 } });
    expect(merged.plans.a1.chat).toHaveLength(1);
    expect(merged.plans.a1.updatedAt).toBe(t2);
  });

  it("drops a fresh browser's untouched plan when the library already has plans, and opens the library's plan", () => {
    const fresh = initialStore("new1", t2);
    const disk = { activeId: "a1", order: ["a1"], plans: [record(planned("a1", "Fade", t1))] };
    const merged = mergeStores(fresh, disk, t2);
    expect(merged.order).toEqual(["a1"]);
    expect(merged.plans.new1).toBeUndefined();
    expect(merged.activeId).toBe("a1");
    // Touched, it's a plan of its own and stays.
    const typed = reduce({ store: fresh, past: [], future: [] }, { type: "setText", field: "description", value: "A barber shop app" }).store;
    expect(mergeStores(typed, disk, t2).order).toEqual(["a1", "new1"]);
  });

  it("keeps the untouched plan on the first run, when the library is empty", () => {
    const fresh = initialStore("new1", t2);
    const merged = mergeStores(fresh, { activeId: "", order: [], plans: [] }, t2);
    expect(merged.order).toEqual(["new1"]);
    expect(merged.activeId).toBe("new1");
  });

  it("falls back to a plan that exists when the open one was deleted elsewhere", () => {
    const browser = store([planned("gone", "Deleted on disk", t0)]);
    const disk = { activeId: "x1", order: ["x1"], plans: [record(planned("x1", "Kept", t1))] };
    const merged = mergeStores(browser, disk, t2);
    expect(merged.activeId).toBe("gone");
    expect(Object.keys(merged.plans).sort()).toEqual(["gone", "x1"]);
  });

  it("sends every plan in order, and replaceStore swaps the store without an undo step", () => {
    const s = store([planned("a1", "A", t1), planned("b2", "B", t1)]);
    expect(toDiskLibrary(s).plans.map((p) => p.id)).toEqual(["a1", "b2"]);
    const history = reduce({ store: initialStore("z", t0), past: [blankPlan("z", t0)], future: [] }, { type: "replaceStore", store: s });
    expect(history.store).toBe(s);
    expect(history.past).toEqual([]);
  });
});
