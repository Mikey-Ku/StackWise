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
import { loadHistory, newId, saveStore } from "./savedStore";
import { reduce, type Guess, type History, type StoreAction } from "./store";

export { newId };

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

  useEffect(() => saveStore(store), [store]);

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
      // The built-in AI saved as the default in the Ask panel reads the description too.
      const provider = savedProvider();
      const response = await fetch("/api/prefill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description, ...(provider ? { provider } : {}) }) });
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

/** The built-in AI picked as the default answerer ("api:openai" and so on), if one was. */
function savedProvider(): string | undefined {
  try {
    const saved = window.localStorage.getItem("stackwise.answerer");
    return saved?.startsWith("api:") ? saved.slice(4) : undefined;
  } catch {
    return undefined;
  }
}
