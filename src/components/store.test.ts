import { describe, expect, it } from "vitest";
import { initialStore, migrate, reduce, THREAD_LIMIT, toSharedPlan, type ChatTurn, type History, type StoreAction } from "./store";

const NOW = "2026-09-15T12:00:00.000Z";

function start(): History {
  return { store: initialStore("p1", NOW), past: [], future: [] };
}

function run(history: History, ...actions: StoreAction[]): History {
  return actions.reduce((h, a) => reduce(h, a, NOW), history);
}

const active = (h: History) => h.store.plans[h.store.activeId];

describe("plan store", () => {
  it("applies a pre-fill as marked guesses without overwriting confirmed answers", () => {
    const h = run(
      start(),
      { type: "answer", needId: "login", answer: "no" },
      {
        type: "applyPrefill",
        by: "ai",
        features: ["Book a time", "Pay a deposit"],
        guesses: { login: { answer: "yes", evidence: "log in" }, users_pay: { answer: "yes", evidence: "pay a deposit" } },
      },
    );
    const plan = active(h);
    expect(plan.answers).toEqual({ login: "no", users_pay: "yes" });
    expect(plan.guesses).toEqual({ users_pay: { answer: "yes", evidence: "pay a deposit", by: "ai" } });
    expect(plan.features).toBe("Book a time\nPay a deposit");
    expect(plan.step).toBe("confirm");
  });

  it("drops an old guess that a new reading doesn't repeat", () => {
    const h = run(
      start(),
      { type: "applyPrefill", by: "keywords", features: [], guesses: { uploads: { answer: "yes", evidence: "photo" } } },
      { type: "applyPrefill", by: "ai", features: [], guesses: { users_pay: { answer: "yes", evidence: "pay" } } },
    );
    expect(active(h).answers).toEqual({ users_pay: "yes" });
  });

  it("confirms a guess when it's answered, and all guesses when the plan is built", () => {
    const h = run(
      start(),
      { type: "applyPrefill", by: "keywords", features: [], guesses: { login: { answer: "yes", evidence: "log in" }, uploads: { answer: "yes", evidence: "photo" } } },
      { type: "answer", needId: "login", answer: "yes" },
    );
    expect(Object.keys(active(h).guesses)).toEqual(["uploads"]);
    expect(active(run(h, { type: "confirmAll" })).guesses).toEqual({});
  });

  it("undoes and redoes plan changes but not typing", () => {
    let h = run(start(), { type: "setText", field: "appName", value: "Fade" }, { type: "place", slot: "hosting", optionId: "render" }, { type: "clearSlot", slot: "database" });
    expect(h.past).toHaveLength(2);
    h = run(h, { type: "undo" });
    expect(active(h).pinned).toEqual({ hosting: "render" });
    expect(active(h).appName).toBe("Fade");
    h = run(h, { type: "undo" }, { type: "undo" });
    expect(active(h).pinned).toEqual({});
    h = run(h, { type: "redo" });
    expect(active(h).pinned).toEqual({ hosting: "render" });
    h = run(h, { type: "autoPick", slot: "hosting" });
    expect(h.future).toEqual([]);
  });

  it("keeps several plans, and deleting the last one leaves a blank plan", () => {
    let h = run(start(), { type: "setText", field: "appName", value: "Fade" }, { type: "duplicatePlan", id: "p2", now: NOW });
    expect(h.store.order).toEqual(["p2", "p1"]);
    expect(active(h).appName).toBe("Fade (copy)");
    h = run(h, { type: "newPlan", id: "p3", now: NOW }, { type: "switchPlan", id: "p1" });
    expect(active(h).appName).toBe("Fade");
    h = run(h, { type: "deletePlan", now: NOW, fallbackId: "x" }, { type: "deletePlan", now: NOW, fallbackId: "x" }, { type: "deletePlan", now: NOW, fallbackId: "fresh" });
    expect(h.store.order).toEqual(["fresh"]);
    expect(active(h).appName).toBe("");
  });

  it("imports a shared plan as a new plan, ready to view", () => {
    const shared = toSharedPlan({ ...active(run(start(), { type: "setText", field: "appName", value: "Fade" }, { type: "place", slot: "hosting", optionId: "render" })) });
    const h = run(start(), { type: "importPlan", id: "p9", now: NOW, plan: shared });
    expect(active(h)).toMatchObject({ id: "p9", appName: "Fade", pinned: { hosting: "render" }, step: "plan" });
    expect(h.store.order).toEqual(["p9", "p1"]);
  });

  it("applies Claude's change to the open plan as one undoable step, and quietly to other plans", () => {
    const h = run(start(), { type: "applyPrefill", by: "keywords", features: [], guesses: { uploads: { answer: "yes", evidence: "photo" } } });
    const plan = { ...toSharedPlan(active(h)), answers: { uploads: "yes" as const, sends_email: "yes" as const }, pinned: { email: "resend" } };
    const changed = run(h, { type: "applyRemote", id: "p1", plan });
    expect(active(changed)).toMatchObject({ answers: { uploads: "yes", sends_email: "yes" }, pinned: { email: "resend" }, guesses: {}, step: "plan" });
    expect(active(run(changed, { type: "undo" })).pinned).toEqual({});

    const two = run(changed, { type: "newPlan", id: "p2", now: NOW });
    const quiet = run(two, { type: "applyRemote", id: "p1", plan: { ...plan, appName: "Renamed by Claude" } });
    expect(quiet.store.plans.p1.appName).toBe("Renamed by Claude");
    expect(quiet.past).toEqual(two.past);
    expect(run(quiet, { type: "applyRemote", id: "missing", plan })).toBe(quiet);
  });

  it("tracks checklist items", () => {
    const h = run(start(), { type: "toggleCheck", itemId: "setup:render:0" }, { type: "toggleCheck", itemId: "build:hosting:render" }, { type: "toggleCheck", itemId: "setup:render:0" });
    expect(active(h).checked).toEqual({ "setup:render:0": false, "build:hosting:render": true });
    expect(h.past).toHaveLength(0);
  });

  it("remembers where parts were moved to, and tidying puts them back", () => {
    const moved = run(start(), { type: "moveNodes", spots: { "slot-hosting": { x: 40, y: -12 } } }, { type: "moveNodes", spots: { app: { x: 5, y: 5 } } });
    expect(active(moved).layout).toEqual({ "slot-hosting": { x: 40, y: -12 }, app: { x: 5, y: 5 } });
    expect(active(run(moved, { type: "tidyLayout" })).layout).toEqual({});
  });

  it("keeps moving a part out of the undo history, so undo stays about the plan", () => {
    const h = run(start(), { type: "answer", needId: "login", answer: "yes" }, { type: "moveNodes", spots: { app: { x: 9, y: 9 } } });
    expect(h.past).toHaveLength(1);
    const back = run(h, { type: "undo" });
    expect(active(back).answers).toEqual({});
  });

  it("remembers the folder the project was written into, and forgets it on request", () => {
    const linked = run(start(), { type: "setFolder", folder: "/Users/me/code/bird-count" });
    expect(active(linked).folder).toBe("/Users/me/code/bird-count");
    expect(active(run(linked, { type: "setFolder", folder: null })).folder).toBeUndefined();
  });

  it("keeps a note per part while typing, drops an empty one, and leaves undo alone", () => {
    const h = run(start(), { type: "editNote", slot: "payments", text: "Use test keys until launch.", optionId: "stripe", at: NOW });
    expect(active(h).notes.payments).toEqual({ text: "Use test keys until launch.", optionId: "stripe", updatedAt: NOW, by: "you" });
    expect(h.past).toHaveLength(0);
    expect(toSharedPlan(active(h)).notes).toEqual(active(h).notes);
    expect(active(run(h, { type: "editNote", slot: "payments", text: "   ", at: NOW })).notes).toEqual({});
  });

  const turn = (id: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({ id, role: "claude", text: `answer ${id}`, at: NOW, ...extra });

  it("uses a suggested note in place of the old one or after it, as one undoable step", () => {
    const suggested = turn("t1", { proposal: { text: "Verify webhook signatures.", summary: "Adds the webhook rule", status: "open" } });
    const base = run(start(), { type: "editNote", slot: "payments", text: "Use test keys.", at: NOW }, { type: "addTurns", slot: "payments", turns: [suggested] });

    const added = run(base, { type: "useNote", slot: "payments", text: "Verify webhook signatures.", mode: "append", by: "claude", at: NOW, turnId: "t1" });
    expect(active(added).notes.payments).toMatchObject({ text: "Use test keys.\n\nVerify webhook signatures.", by: "claude" });
    expect(active(added).threads.payments![0].proposal!.status).toBe("added");

    const replaced = run(base, { type: "useNote", slot: "payments", text: "Verify webhook signatures.", mode: "replace", by: "claude", at: NOW, turnId: "t1" });
    expect(active(replaced).notes.payments!.text).toBe("Verify webhook signatures.");
    expect(active(replaced).threads.payments![0].proposal!.status).toBe("used");

    const undone = run(replaced, { type: "undo" });
    expect(active(undone).notes.payments!.text).toBe("Use test keys.");
    expect(active(undone).threads.payments![0].proposal!.status).toBe("open");
  });

  it("switches to a suggested option as one undoable step", () => {
    const base = run(start(), { type: "addTurns", slot: "email", turns: [turn("t1", { swap: { optionId: "postmark", status: "open" } })] });
    const swapped = run(base, { type: "useSwap", slot: "email", optionId: "postmark", turnId: "t1" });
    expect(active(swapped).pinned.email).toBe("postmark");
    expect(active(swapped).threads.email![0].swap!.status).toBe("used");
    expect(active(run(swapped, { type: "undo" })).pinned.email).toBeUndefined();
  });

  it("keeps the latest turns of a conversation, dismisses suggestions and clears on request", () => {
    const many = Array.from({ length: THREAD_LIMIT + 5 }, (_, i) => turn(`t${i}`));
    const h = run(start(), { type: "addTurns", slot: "ai", turns: many }, { type: "addTurns", slot: "ai", turns: [turn("last", { proposal: { text: "x", summary: "y", status: "open" }, text: "z".repeat(9000) })] });
    const thread = active(h).threads.ai!;
    expect(thread).toHaveLength(THREAD_LIMIT);
    expect(thread.at(-1)!.id).toBe("last");
    expect(thread.at(-1)!.text.length).toBe(4000);
    expect(h.past).toHaveLength(0);

    const dismissed = run(h, { type: "dismissSuggestion", slot: "ai", turnId: "last", what: "proposal" });
    expect(active(dismissed).threads.ai!.at(-1)!.proposal!.status).toBe("dismissed");
    expect(active(run(dismissed, { type: "clearThread", slot: "ai" })).threads.ai).toBeUndefined();
  });

  it("takes notes from Claude's changes and from imported plans", () => {
    const h = run(start(), { type: "setText", field: "appName", value: "Fade" });
    const shared = { ...toSharedPlan(active(h)), notes: { email: { text: "Send from hello@", updatedAt: NOW, by: "claude" as const } } };
    expect(active(run(h, { type: "applyRemote", id: "p1", plan: shared })).notes.email!.by).toBe("claude");
    expect(active(run(h, { type: "importPlan", id: "p2", now: NOW, plan: shared })).notes.email!.text).toBe("Send from hello@");
  });

  it("copies the layout and the folder into a duplicate", () => {
    const h = run(start(), { type: "moveNodes", spots: { app: { x: 3, y: 4 } } }, { type: "setFolder", folder: "/Users/me/code/a" }, { type: "duplicatePlan", id: "p2", now: NOW });
    expect(active(h).layout).toEqual({ app: { x: 3, y: 4 } });
    expect(active(h).folder).toBe("/Users/me/code/a");
  });
});

describe("saved data from the first release", () => {
  it("wraps a version 1 plan into a store and converts its keyword guesses", () => {
    const store = migrate(
      { version: 1, step: "plan", appName: "Fade", description: "d", features: "", answers: { login: "yes" }, guesses: { uploads: "photo" }, size: "up_to_100", priority: "learn", builderId: "cursor", pinned: { hosting: "render" }, selectedSlot: "hosting" },
      "p1",
      NOW,
    )!;
    const plan = store.plans.p1;
    expect(plan).toMatchObject({ appName: "Fade", priority: "learn", pinned: { hosting: "render" }, checked: {} });
    expect(plan.guesses).toEqual({ uploads: { answer: "yes", evidence: "photo", by: "keywords" } });
    expect("selectedSlot" in plan).toBe(false);
  });

  it("fills in what a later release added, like the canvas layout", () => {
    const saved = { version: 2, activeId: "p1", order: ["p1"], plans: { p1: { id: "p1", createdAt: NOW, updatedAt: NOW, step: "plan", appName: "Fade", description: "", features: "", answers: {}, guesses: {}, size: "up_to_100", priority: "learn", builderId: "cursor", pinned: {}, checked: {} } } };
    const plan = migrate(saved, "p9", NOW)!.plans.p1;
    expect(plan.layout).toEqual({});
    expect(plan.priority).toBe("learn");
  });

  it("ignores anything it doesn't recognize", () => {
    expect(migrate(null, "p", NOW)).toBeNull();
    expect(migrate({ version: 7 }, "p", NOW)).toBeNull();
    expect(migrate({ version: 2, activeId: "gone", plans: {} }, "p", NOW)).toBeNull();
  });
});
