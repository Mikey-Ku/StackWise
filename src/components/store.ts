import { NOTE_MAX, type Answer, type CustomPart, type Extra, type Note, type PlanLink, type PriorityId, type Selection, type SharedPlan, type SizeId, type SlotId } from "@/engine";

/**
 * Every plan the person has, kept in their browser. Pure functions only, so the rules for undo,
 * sharing and old saved data are tested without a browser.
 */

export type Step = "describe" | "confirm" | "plan";

export interface Guess {
  answer: "yes" | "no" | "not_sure";
  /** The words behind the guess, or the template's name when a template made it. */
  evidence: string;
  by: "ai" | "keywords" | "template";
}

/** Where a canvas node sits after someone moved it, in the canvas's own coordinates. */
export interface Spot {
  x: number;
  y: number;
}

/**
 * One message in the plan's conversation with the built-in AI. Messages to and from coding agents
 * live in the shared plan on the server instead, so the agent can read them; the Ask panel shows
 * both in one timeline.
 */
export interface ChatTurn {
  id: string;
  /** "facts" is StackWise answering from its own data when Claude isn't available. */
  role: "you" | "claude" | "facts";
  text: string;
  at: string;
  /** The part of the plan it's about. Suggestions apply to this part. */
  about: SlotId;
  /** Which built-in AI wrote it, when one did. Older turns are Claude's. */
  by?: string;
  /** A note the answer suggested, until it's used or dismissed. */
  proposal?: { text: string; summary: string; status: "open" | "used" | "added" | "dismissed" };
  /** An option the answer suggested switching to. Its verdict always comes from StackWise's rules. */
  swap?: { optionId: string; status: "open" | "used" | "dismissed" };
}

export const CHAT_LIMIT = 80;
export const TURN_MAX = 4000;

export interface PlanState {
  id: string;
  createdAt: string;
  updatedAt: string;
  step: Step;
  appName: string;
  description: string;
  features: string;
  answers: Record<string, Answer>;
  /** Pre-filled answers not yet confirmed, with the words behind each. */
  guesses: Record<string, Guess>;
  size: SizeId;
  priority: PriorityId;
  builderId: string;
  /** Slots the person set by hand. An empty string means they cleared it. */
  pinned: Selection;
  /** Checklist items marked done. */
  checked: Record<string, boolean>;
  /** Canvas nodes the person moved, by node id. Anything missing sits where StackWise puts it. */
  layout: Record<string, Spot>;
  /** Notes on each part and the line to it. Shared with the plan, exported, and editable by Claude. */
  notes: Partial<Record<SlotId, Note>>;
  /** Parts StackWise has no facts on, added by hand, by id ("custom-..."). Shared and exported like notes. */
  custom: Record<string, CustomPart>;
  /** Extra services in a part, by "<part>.<name>" ("database.cache"): checked and priced like the rest. */
  extras: Record<string, Extra>;
  /** Lines between things in the plan, by "<from>><to>". */
  links: Record<string, PlanLink>;
  /** The conversation about this plan. Only in this browser: the notes are what's kept. */
  chat: ChatTurn[];
  /** A folder on this computer the project files were written into, if there is one. */
  folder?: string;
  /** The app's own logo, as a small data URL. Only in this browser, like the layout. */
  icon?: string;
}

export interface Store {
  version: 2;
  activeId: string;
  order: string[];
  plans: Record<string, PlanState>;
}

export interface History {
  store: Store;
  past: PlanState[];
  future: PlanState[];
}

export type PlanAction =
  | { type: "setText"; field: "appName" | "description" | "features"; value: string }
  | { type: "applyPrefill"; guesses: Record<string, Omit<Guess, "by">>; by: Guess["by"]; features: string[] }
  | { type: "answer"; needId: string; answer: Answer }
  | { type: "setSize"; size: SizeId }
  | { type: "setPriority"; priority: PriorityId }
  | { type: "setBuilder"; builderId: string }
  | { type: "confirmAll" }
  | { type: "goTo"; step: Step }
  | { type: "place"; slot: SlotId; optionId: string }
  | { type: "clearSlot"; slot: SlotId }
  | { type: "autoPick"; slot: SlotId }
  | { type: "toggleCheck"; itemId: string }
  /** Typing in a note. An empty note is removed. */
  | { type: "editNote"; slot: SlotId; text: string; optionId?: string; at: string }
  /** Using a suggested note, in place of the old one or after it. Undoable. */
  | { type: "useNote"; slot: SlotId; text: string; mode: "replace" | "append"; by: Note["by"]; optionId?: string; at: string; turnId?: string }
  /** Switching to a suggested option. Undoable, and the rules check it like any other choice. */
  | { type: "useSwap"; slot: SlotId; optionId: string; turnId: string }
  | { type: "addTurns"; turns: ChatTurn[] }
  | { type: "dismissSuggestion"; turnId: string; what: "proposal" | "swap" }
  | { type: "clearChat" }
  | { type: "moveNodes"; spots: Record<string, Spot> }
  | { type: "tidyLayout" }
  | { type: "setFolder"; folder: string | null }
  | { type: "setIcon"; icon: string | null }
  | { type: "loadExample"; appName: string; description: string }
  /** Adding or editing a part StackWise has no facts on. Undoable. */
  | { type: "setCustom"; id: string; part: CustomPart }
  | { type: "removeCustom"; id: string }
  /** Adding or changing an extra service in a part. Undoable. */
  | { type: "setExtra"; id: string; extra: Extra }
  | { type: "removeExtra"; id: string }
  /** Drawing, relabeling or removing a line between two things. Undoable. */
  | { type: "setLink"; id: string; link: PlanLink }
  | { type: "removeLink"; id: string }
  /** Start from a kind of app: its answers become guesses to confirm, and it may pick a phone toolkit. */
  | { type: "applyTemplate"; label: string; description: string; answers: Record<string, Answer>; pinned?: Selection }
  | { type: "resetPlan" };

export type StoreAction =
  | PlanAction
  | { type: "newPlan"; id: string; now: string }
  | { type: "duplicatePlan"; id: string; now: string }
  | { type: "deletePlan"; now: string; fallbackId: string }
  | { type: "switchPlan"; id: string }
  | { type: "importPlan"; id: string; now: string; plan: SharedPlan }
  /** A change Claude made through StackWise's MCP server. On the open plan it can be undone. */
  | { type: "applyRemote"; id: string; plan: SharedPlan }
  | { type: "undo" }
  | { type: "redo" };

/** Changes worth undoing: the ones that change the plan, not typing or checking boxes. */
const UNDOABLE = new Set<StoreAction["type"]>(["applyPrefill", "answer", "setSize", "setPriority", "confirmAll", "place", "clearSlot", "autoPick", "useNote", "useSwap", "loadExample", "applyTemplate", "resetPlan", "setCustom", "removeCustom", "setExtra", "removeExtra", "setLink", "removeLink"]);
const HISTORY_LIMIT = 50;

export function blankPlan(id: string, now: string): PlanState {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    step: "describe",
    appName: "",
    description: "",
    features: "",
    answers: {},
    guesses: {},
    size: "up_to_100",
    priority: "spend_zero",
    builderId: "claude-code",
    pinned: {},
    checked: {},
    layout: {},
    notes: {},
    custom: {},
    extras: {},
    links: {},
    chat: [],
  };
}

/** Links that don't touch `end`: removing something takes its lines with it. */
function withoutLinksTo(links: Record<string, PlanLink>, end: string): Record<string, PlanLink> {
  return Object.fromEntries(Object.entries(links).filter(([, link]) => link.from !== end && link.to !== end));
}

function withNote(plan: PlanState, slot: SlotId, note: Note | null): PlanState {
  const notes = { ...plan.notes };
  if (note && note.text.trim()) notes[slot] = { ...note, text: note.text.slice(0, NOTE_MAX) };
  else delete notes[slot];
  return { ...plan, notes };
}

function mapTurn(plan: PlanState, turnId: string | undefined, change: (turn: ChatTurn) => ChatTurn): PlanState {
  if (!turnId) return plan;
  return { ...plan, chat: plan.chat.map((turn) => (turn.id === turnId ? change(turn) : turn)) };
}

export function initialStore(id: string, now: string): Store {
  return { version: 2, activeId: id, order: [id], plans: { [id]: blankPlan(id, now) } };
}

function reducePlan(plan: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case "setText":
      return { ...plan, [action.field]: action.value };
    case "applyPrefill": {
      const answers = { ...plan.answers };
      const guesses: Record<string, Guess> = {};
      for (const [needId, guess] of Object.entries(action.guesses)) {
        // A confirmed answer always beats a new guess.
        if (answers[needId] !== undefined && !(needId in plan.guesses)) continue;
        answers[needId] = guess.answer;
        guesses[needId] = { ...guess, by: action.by };
      }
      for (const needId of Object.keys(plan.guesses)) {
        if (!(needId in guesses)) delete answers[needId]; // an old guess that the new reading doesn't repeat
      }
      const features = plan.features.trim() || action.features.join("\n");
      return { ...plan, answers, guesses, features, step: "confirm" };
    }
    case "answer": {
      const guesses = { ...plan.guesses };
      delete guesses[action.needId];
      return { ...plan, answers: { ...plan.answers, [action.needId]: action.answer }, guesses };
    }
    case "setSize":
      return { ...plan, size: action.size };
    case "setPriority":
      return { ...plan, priority: action.priority };
    case "setBuilder":
      return { ...plan, builderId: action.builderId };
    case "confirmAll":
      return { ...plan, guesses: {}, step: "plan" };
    case "goTo":
      return { ...plan, step: action.step };
    case "place":
      return { ...plan, pinned: { ...plan.pinned, [action.slot]: action.optionId } };
    case "clearSlot":
      return { ...plan, pinned: { ...plan.pinned, [action.slot]: "" } };
    case "autoPick": {
      const pinned = { ...plan.pinned };
      delete pinned[action.slot];
      return { ...plan, pinned };
    }
    case "toggleCheck":
      return { ...plan, checked: { ...plan.checked, [action.itemId]: !plan.checked[action.itemId] } };
    case "editNote":
      return withNote(plan, action.slot, { text: action.text, optionId: action.optionId, updatedAt: action.at, by: "you" });
    case "useNote": {
      const old = plan.notes[action.slot]?.text.trim();
      const text = action.mode === "append" && old ? `${old}\n\n${action.text.trim()}` : action.text.trim();
      const next = withNote(plan, action.slot, { text, optionId: action.optionId, updatedAt: action.at, by: action.by });
      return mapTurn(next, action.turnId, (turn) => (turn.proposal ? { ...turn, proposal: { ...turn.proposal, status: action.mode === "append" ? "added" : "used" } } : turn));
    }
    case "useSwap": {
      const next = { ...plan, pinned: { ...plan.pinned, [action.slot]: action.optionId } };
      return mapTurn(next, action.turnId, (turn) => (turn.swap ? { ...turn, swap: { ...turn.swap, status: "used" } } : turn));
    }
    case "addTurns": {
      const turns = action.turns.map((turn) => ({ ...turn, text: turn.text.slice(0, TURN_MAX) }));
      return { ...plan, chat: [...plan.chat, ...turns].slice(-CHAT_LIMIT) };
    }
    case "dismissSuggestion":
      return mapTurn(plan, action.turnId, (turn) =>
        action.what === "proposal" && turn.proposal
          ? { ...turn, proposal: { ...turn.proposal, status: "dismissed" } }
          : action.what === "swap" && turn.swap
            ? { ...turn, swap: { ...turn.swap, status: "dismissed" } }
            : turn,
      );
    case "clearChat":
      return { ...plan, chat: [] };
    case "moveNodes":
      return { ...plan, layout: { ...plan.layout, ...action.spots } };
    case "tidyLayout":
      return { ...plan, layout: {} };
    case "setFolder": {
      const next = { ...plan };
      if (action.folder) next.folder = action.folder;
      else delete next.folder;
      return next;
    }
    case "setIcon": {
      const next = { ...plan };
      if (action.icon) next.icon = action.icon;
      else delete next.icon;
      return next;
    }
    case "setCustom":
      return { ...plan, custom: { ...plan.custom, [action.id]: action.part } };
    case "removeCustom": {
      const custom = { ...plan.custom };
      delete custom[action.id];
      const layout = { ...plan.layout };
      delete layout[action.id];
      return { ...plan, custom, layout, links: withoutLinksTo(plan.links, action.id) };
    }
    case "setExtra":
      return { ...plan, extras: { ...plan.extras, [action.id]: action.extra } };
    case "removeExtra": {
      const extras = { ...plan.extras };
      delete extras[action.id];
      const layout = { ...plan.layout };
      delete layout[`extra-${action.id}`];
      return { ...plan, extras, layout, links: withoutLinksTo(plan.links, action.id) };
    }
    case "setLink":
      return { ...plan, links: { ...plan.links, [action.id]: action.link } };
    case "removeLink": {
      const links = { ...plan.links };
      delete links[action.id];
      return { ...plan, links };
    }
    case "loadExample":
      return { ...blankPlan(plan.id, plan.createdAt), appName: action.appName, description: action.description };
    case "applyTemplate": {
      const guesses = Object.fromEntries(Object.entries(action.answers).map(([needId, answer]) => [needId, { answer, evidence: action.label, by: "template" as const }]));
      return {
        ...plan,
        description: plan.description.trim() || action.description,
        answers: { ...action.answers },
        guesses,
        pinned: { ...action.pinned },
        step: "confirm",
      };
    }
    case "resetPlan":
      return blankPlan(plan.id, plan.createdAt);
  }
}

function withPlan(store: Store, plan: PlanState): Store {
  return { ...store, plans: { ...store.plans, [plan.id]: plan } };
}

export function reduce(history: History, action: StoreAction, now = new Date().toISOString()): History {
  const { store } = history;
  const active = store.plans[store.activeId];

  switch (action.type) {
    case "newPlan":
      return { store: { ...withPlan(store, blankPlan(action.id, action.now)), activeId: action.id, order: [action.id, ...store.order] }, past: [], future: [] };
    case "duplicatePlan": {
      const copy: PlanState = { ...structuredClone(active), id: action.id, createdAt: action.now, updatedAt: action.now, appName: `${active.appName.trim() || "Untitled app"} (copy)` };
      return { store: { ...withPlan(store, copy), activeId: action.id, order: [action.id, ...store.order] }, past: [], future: [] };
    }
    case "deletePlan": {
      const plans = { ...store.plans };
      delete plans[store.activeId];
      const order = store.order.filter((id) => id !== store.activeId);
      if (order.length === 0) return { store: initialStore(action.fallbackId, action.now), past: [], future: [] };
      return { store: { ...store, plans, order, activeId: order[0] }, past: [], future: [] };
    }
    case "switchPlan":
      return store.plans[action.id] ? { store: { ...store, activeId: action.id }, past: [], future: [] } : history;
    case "importPlan": {
      const plan: PlanState = {
        ...blankPlan(action.id, action.now),
        appName: action.plan.appName,
        description: action.plan.description,
        features: action.plan.features,
        answers: action.plan.answers,
        size: action.plan.size,
        priority: action.plan.priority,
        builderId: action.plan.builderId,
        pinned: action.plan.pinned,
        notes: action.plan.notes,
        custom: action.plan.custom ?? {},
        extras: action.plan.extras ?? {},
        links: action.plan.links ?? {},
        step: "plan",
      };
      return { store: { ...withPlan(store, plan), activeId: action.id, order: [action.id, ...store.order] }, past: [], future: [] };
    }
    case "applyRemote": {
      const target = store.plans[action.id];
      if (!target) return history;
      const guesses = Object.fromEntries(Object.entries(target.guesses).filter(([needId]) => !(needId in action.plan.answers)));
      const updated: PlanState = {
        ...target,
        appName: action.plan.appName,
        description: action.plan.description,
        features: action.plan.features,
        answers: action.plan.answers,
        size: action.plan.size,
        priority: action.plan.priority,
        builderId: action.plan.builderId,
        pinned: action.plan.pinned,
        notes: action.plan.notes,
        custom: action.plan.custom ?? {},
        extras: action.plan.extras ?? {},
        links: action.plan.links ?? {},
        guesses,
        // Claude's answers count as confirmed, so show the plan rather than a preview.
        step: Object.keys(action.plan.answers).length > 0 ? "plan" : target.step,
        updatedAt: now,
      };
      const next = withPlan(store, updated);
      if (action.id !== store.activeId) return { ...history, store: next };
      return { store: next, past: [...history.past, target].slice(-HISTORY_LIMIT), future: [] };
    }
    case "undo": {
      const previous = history.past[history.past.length - 1];
      if (!previous) return history;
      return { store: withPlan(store, previous), past: history.past.slice(0, -1), future: [active, ...history.future] };
    }
    case "redo": {
      const next = history.future[0];
      if (!next) return history;
      return { store: withPlan(store, next), past: [...history.past, active], future: history.future.slice(1) };
    }
    default: {
      const updated = { ...reducePlan(active, action), updatedAt: now };
      const next = withPlan(store, updated);
      if (!UNDOABLE.has(action.type)) return { ...history, store: next };
      return { store: next, past: [...history.past, active].slice(-HISTORY_LIMIT), future: [] };
    }
  }
}

export function toSharedPlan(plan: PlanState): SharedPlan {
  return {
    v: 1,
    appName: plan.appName,
    description: plan.description,
    features: plan.features,
    answers: plan.answers,
    size: plan.size,
    priority: plan.priority,
    builderId: plan.builderId,
    pinned: plan.pinned,
    notes: plan.notes,
    ...(Object.keys(plan.custom).length ? { custom: plan.custom } : {}),
    ...(Object.keys(plan.extras).length ? { extras: plan.extras } : {}),
    ...(Object.keys(plan.links).length ? { links: plan.links } : {}),
  };
}

/** Before one conversation per plan there was one per part. Their turns merge in time order, each tagged with its part. */
function withOneChat(plan: PlanState & { threads?: Partial<Record<SlotId, Omit<ChatTurn, "about">[]>> }): PlanState {
  if (!plan.threads) return plan;
  const { threads, ...rest } = plan;
  const merged = Object.entries(threads).flatMap(([slot, turns]) => (turns ?? []).map((turn) => ({ ...turn, about: slot as SlotId })));
  const chat = [...rest.chat, ...merged].sort((a, b) => a.at.localeCompare(b.at)).slice(-CHAT_LIMIT);
  return { ...rest, chat };
}

/**
 * Read whatever was saved before. Version 2 is kept, with defaults filled in for anything a later
 * release added; the single-plan version 1 from the first release is wrapped into a store, with
 * its keyword guesses converted.
 */
export function migrate(raw: unknown, id: string, now: string): Store | null {
  if (!raw || typeof raw !== "object") return null;
  const saved = raw as Record<string, unknown>;
  if (saved.version === 2 && saved.plans && typeof saved.activeId === "string") {
    const store = saved as unknown as Store;
    if (!store.plans[store.activeId]) return null;
    // Anything a later release added, like the canvas layout, gets its default. What was saved wins.
    const plans = Object.fromEntries(Object.entries(store.plans).map(([planId, plan]) => [planId, withOneChat({ ...blankPlan(planId, plan.createdAt ?? now), ...plan })]));
    return { ...store, plans };
  }
  if (saved.version === 1) {
    const oldGuesses = (saved.guesses ?? {}) as Record<string, string>;
    const plan: PlanState = {
      ...blankPlan(id, now),
      ...(saved as Partial<PlanState>),
      id,
      createdAt: now,
      updatedAt: now,
      checked: {},
      guesses: Object.fromEntries(Object.entries(oldGuesses).map(([needId, words]) => [needId, { answer: "yes" as const, evidence: String(words), by: "keywords" as const }])),
    };
    delete (plan as Partial<PlanState> & { selectedSlot?: unknown; version?: unknown }).selectedSlot;
    delete (plan as Partial<PlanState> & { version?: unknown }).version;
    return { version: 2, activeId: id, order: [id], plans: { [id]: plan } };
  }
  return null;
}
