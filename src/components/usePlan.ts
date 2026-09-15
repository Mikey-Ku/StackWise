"use client";

import { useEffect, useMemo, useReducer } from "react";
import {
  closeCalls,
  costOutlook,
  headsUps,
  indexCatalog,
  prefillFromKeywords,
  questionsThatMatter,
  recommend,
  SLOT_IDS,
  type Answer,
  type Catalog,
  type PlanInput,
  type PriorityId,
  type Selection,
  type SizeId,
  type SlotId,
} from "@/engine";

export type Step = "describe" | "confirm" | "plan";

export interface PlanState {
  version: 1;
  step: Step;
  appName: string;
  description: string;
  features: string;
  answers: Record<string, Answer>;
  /** Needs guessed from the description and not yet confirmed, with the words that matched. */
  guesses: Record<string, string>;
  size: SizeId;
  priority: PriorityId;
  builderId: string;
  /** Slots the person set by hand. An empty string means they cleared it. */
  pinned: Selection;
  selectedSlot: SlotId | null;
}

const STORAGE_KEY = "whystack.plan.v1";

export const initialState: PlanState = {
  version: 1,
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
  selectedSlot: null,
};

type Action =
  | { type: "setText"; field: "appName" | "description" | "features"; value: string }
  | { type: "readDescription"; guesses: Record<string, string> }
  | { type: "answer"; needId: string; answer: Answer }
  | { type: "setSize"; size: SizeId }
  | { type: "setPriority"; priority: PriorityId }
  | { type: "setBuilder"; builderId: string }
  | { type: "confirmAll" }
  | { type: "goTo"; step: Step }
  | { type: "place"; slot: SlotId; optionId: string }
  | { type: "clearSlot"; slot: SlotId }
  | { type: "autoPick"; slot: SlotId }
  | { type: "select"; slot: SlotId | null }
  | { type: "reset" };

function reducer(state: PlanState, action: Action): PlanState {
  switch (action.type) {
    case "setText":
      return { ...state, [action.field]: action.value };
    case "readDescription": {
      const answers = { ...state.answers };
      const guesses: Record<string, string> = {};
      for (const [needId, matched] of Object.entries(action.guesses)) {
        if (answers[needId] !== undefined && !(needId in state.guesses)) continue; // never overwrite a confirmed answer
        answers[needId] = "yes";
        guesses[needId] = matched;
      }
      return { ...state, answers, guesses, step: "confirm" };
    }
    case "answer": {
      const guesses = { ...state.guesses };
      delete guesses[action.needId]; // touching an answer confirms it
      return { ...state, answers: { ...state.answers, [action.needId]: action.answer }, guesses };
    }
    case "setSize":
      return { ...state, size: action.size };
    case "setPriority":
      return { ...state, priority: action.priority };
    case "setBuilder":
      return { ...state, builderId: action.builderId };
    case "confirmAll":
      return { ...state, guesses: {}, step: "plan" };
    case "goTo":
      return { ...state, step: action.step };
    case "place":
      return { ...state, pinned: { ...state.pinned, [action.slot]: action.optionId }, selectedSlot: action.slot };
    case "clearSlot":
      return { ...state, pinned: { ...state.pinned, [action.slot]: "" }, selectedSlot: action.slot };
    case "autoPick": {
      const pinned = { ...state.pinned };
      delete pinned[action.slot];
      return { ...state, pinned };
    }
    case "select":
      return { ...state, selectedSlot: action.slot };
    case "reset":
      return initialState;
  }
}

function loadState(): PlanState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<PlanState>;
    return parsed.version === 1 ? { ...initialState, ...parsed } : initialState;
  } catch {
    return initialState;
  }
}

export function usePlan(catalog: Catalog) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const index = useMemo(() => indexCatalog(catalog), [catalog]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private windows and blocked storage: the plan still works, it just won't survive a reload.
    }
  }, [state]);

  const input: PlanInput = useMemo(
    () => ({ answers: state.answers, size: state.size, priority: state.priority }),
    [state.answers, state.size, state.priority],
  );

  const rec = useMemo(() => recommend(index, input, state.pinned), [index, input, state.pinned]);
  const calls = useMemo(() => closeCalls(index, input, rec), [index, input, rec]);
  const followups = useMemo(() => questionsThatMatter(index, input, state.pinned), [index, input, state.pinned]);
  const notSure = useMemo(() => headsUps(index, input, state.pinned), [index, input, state.pinned]);
  const cost = useMemo(() => costOutlook(index, rec.selection, input), [index, rec.selection, input]);

  /** Put an option on the canvas. Returns an error message when it doesn't fit the slot it was dropped on. */
  const place = (optionId: string, slot?: SlotId): string | null => {
    const option = index.optionsById.get(optionId);
    if (!option) return "That option no longer exists.";
    if (slot && !option.slots.includes(slot)) {
      const fits = option.slots.map((s) => index.slotsById.get(s)?.label).join(" or ");
      return `${option.name} goes in ${fits}, not ${index.slotsById.get(slot)?.label}.`;
    }
    const target = slot ?? (state.selectedSlot && option.slots.includes(state.selectedSlot) ? state.selectedSlot : option.slots[0]);
    dispatch({ type: "place", slot: target, optionId });
    return null;
  };

  const readDescription = () => dispatch({ type: "readDescription", guesses: prefillFromKeywords(state.description, catalog.needs) });

  return { state, dispatch, catalog, index, input, rec, calls, followups, notSure, cost, place, readDescription, slots: SLOT_IDS };
}

export type PlanModel = ReturnType<typeof usePlan>;
