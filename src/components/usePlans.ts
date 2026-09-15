"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  buildChecklist,
  closeCalls,
  costBySize,
  costOutlook,
  headsUps,
  indexCatalog,
  planStats,
  prefillFromKeywords,
  questionsThatMatter,
  recommend,
  type Catalog,
  type PlanInput,
  type SlotId,
} from "@/engine";
import { initialStore, migrate, reduce, type Guess, type History, type StoreAction } from "./store";

const STORE_KEY = "whystack.store.v2";
const OLD_KEY = "whystack.plan.v1";

export function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function loadHistory(): History {
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

export interface PrefillStatus {
  loading: boolean;
  by?: Guess["by"];
  note?: string;
}

export function usePlans(catalog: Catalog) {
  const [history, dispatch] = useReducer((h: History, action: StoreAction) => reduce(h, action), undefined, loadHistory);
  const [prefill, setPrefill] = useState<PrefillStatus>({ loading: false });
  const { store } = history;
  const plan = store.plans[store.activeId];
  const index = useMemo(() => indexCatalog(catalog), [catalog]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
      window.localStorage.removeItem(OLD_KEY);
    } catch {
      // Private windows and blocked storage: plans still work, they just won't survive a reload.
    }
  }, [store]);

  const input: PlanInput = useMemo(() => ({ answers: plan.answers, size: plan.size, priority: plan.priority }), [plan.answers, plan.size, plan.priority]);
  const rec = useMemo(() => recommend(index, input, plan.pinned), [index, input, plan.pinned]);
  const calls = useMemo(() => closeCalls(index, input, rec), [index, input, rec]);
  const followups = useMemo(() => questionsThatMatter(index, input, plan.pinned), [index, input, plan.pinned]);
  const notSure = useMemo(() => headsUps(index, input, plan.pinned), [index, input, plan.pinned]);
  const cost = useMemo(() => costOutlook(index, rec.selection, input), [index, rec.selection, input]);
  const costSizes = useMemo(() => costBySize(index, rec.selection, input), [index, rec.selection, input]);
  const checklist = useMemo(() => buildChecklist(index, rec.selection), [index, rec.selection]);
  const stats = useMemo(() => planStats(index, input, rec), [index, input, rec]);

  /** Put an option on the canvas. Returns a reason when it doesn't fit the slot it was dropped on. */
  const place = useCallback(
    (optionId: string, slot?: SlotId, preferred?: SlotId | null): string | null => {
      const option = index.optionsById.get(optionId);
      if (!option) return "That option no longer exists.";
      if (slot && !option.slots.includes(slot)) {
        const fits = option.slots.map((s) => index.slotsById.get(s)?.label).join(" or ");
        return `${option.name} goes in ${fits}, not ${index.slotsById.get(slot)?.label}.`;
      }
      const target = slot ?? (preferred && option.slots.includes(preferred) ? preferred : option.slots[0]);
      dispatch({ type: "place", slot: target, optionId });
      return null;
    },
    [index, dispatch],
  );

  const readDescription = useCallback(async () => {
    const description = plan.description;
    setPrefill({ loading: true });
    try {
      const response = await fetch("/api/prefill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { by: Guess["by"]; guesses: Record<string, Omit<Guess, "by">>; features: string[]; note?: string };
      dispatch({ type: "applyPrefill", by: result.by, guesses: result.guesses, features: result.features });
      setPrefill({ loading: false, by: result.by, note: result.note });
    } catch {
      // The server is unreachable: keyword guesses still work entirely in the browser.
      const guesses = Object.fromEntries(Object.entries(prefillFromKeywords(description, catalog.needs)).map(([id, words]) => [id, { answer: "yes" as const, evidence: words }]));
      dispatch({ type: "applyPrefill", by: "keywords", guesses, features: [] });
      setPrefill({ loading: false, by: "keywords", note: "Couldn't reach the server, so keywords were used." });
    }
  }, [plan.description, catalog.needs, dispatch]);

  return { history, store, plan, dispatch, catalog, index, input, rec, calls, followups, notSure, cost, costSizes, checklist, stats, place, readDescription, prefill };
}

export type PlanModel = ReturnType<typeof usePlans>;
