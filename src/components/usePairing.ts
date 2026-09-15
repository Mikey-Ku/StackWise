"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedPlan } from "@/engine";
import { toSharedPlan, type History, type StoreAction } from "./store";

/**
 * Pairing with Claude from the browser side. When it's on, the plan you have open is shared with
 * WhyStack's server, where Claude's MCP tools read and change it. Whether or not it's on, the tab
 * keeps asking the server what Claude did, so changes from a paired session or an exported
 * project show up here, as undoable steps, with Claude's reasons in the Claude tab.
 */

export interface ClaudeActivity {
  id: string;
  at: string;
  tool: string;
  summary: string;
  changes: string[];
  verdict?: string;
}

interface SharedRecord {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy: "browser" | "claude";
  plan: SharedPlan;
  activity: ClaudeActivity[];
}

const PAIRING_KEY = "whystack.pairing";
const POLL_MS = 1500;

export function usePairing({
  history,
  dispatch,
  onClaudeChange,
}: {
  history: History;
  dispatch: (action: StoreAction) => void;
  onClaudeChange: (appName: string, change: ClaudeActivity | undefined) => void;
}) {
  const [enabled, setEnabledState] = useState(() => {
    try {
      return window.localStorage.getItem(PAIRING_KEY) === "on";
    } catch {
      return false;
    }
  });
  const [activity, setActivity] = useState<Record<string, ClaudeActivity[]>>({});
  const [reachable, setReachable] = useState<boolean | null>(null);
  const known = useRef<Record<string, number>>({});
  const synced = useRef<Record<string, string>>({});
  const sharedId = useRef<string | null>(null);
  const since = useRef("1970-01-01T00:00:00.000Z");
  const storeRef = useRef(history.store);
  const active = history.store.plans[history.store.activeId];

  useEffect(() => {
    storeRef.current = history.store;
  }, [history.store]);

  const applyRecord = useCallback(
    (record: SharedRecord) => {
      const local = storeRef.current.plans[record.id];
      const remote = JSON.stringify(record.plan);
      const newer = record.updatedBy === "claude" && record.version > (known.current[record.id] ?? 0) && Date.parse(record.updatedAt) > Date.parse(local?.updatedAt ?? "");
      if (local && newer && remote !== JSON.stringify(toSharedPlan(local))) {
        dispatch({ type: "applyRemote", id: record.id, plan: record.plan });
        onClaudeChange(record.plan.appName, [...record.activity].reverse().find((a) => a.tool === "update_plan"));
      }
      known.current[record.id] = Math.max(known.current[record.id] ?? 0, record.version);
      synced.current[record.id] = remote;
    },
    [dispatch, onClaudeChange],
  );

  // Ask the server what Claude changed or did since the last look.
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const response = await fetch(`/api/pair?since=${encodeURIComponent(since.current)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { now: string; records: SharedRecord[] };
        since.current = body.now;
        setReachable(true);
        if (body.records.length) {
          setActivity((previous) => ({ ...previous, ...Object.fromEntries(body.records.map((r) => [r.id, r.activity])) }));
          body.records.forEach(applyRecord);
        }
      } catch {
        setReachable(false);
      }
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [applyRecord]);

  // Share the open plan whenever it changes, or when you switch plans.
  useEffect(() => {
    if (!enabled) return;
    const plan = toSharedPlan(active);
    const json = JSON.stringify(plan);
    if (synced.current[active.id] === json && sharedId.current === active.id) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/pair", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: active.id, plan, baseVersion: known.current[active.id] ?? 0 }),
        });
        if (response.status === 409) {
          applyRecord(((await response.json()) as { record: SharedRecord }).record);
          sharedId.current = active.id;
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { version } = (await response.json()) as { version: number };
        known.current[active.id] = version;
        synced.current[active.id] = json;
        sharedId.current = active.id;
        setReachable(true);
      } catch {
        setReachable(false);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [enabled, active, applyRecord]);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      window.localStorage.setItem(PAIRING_KEY, on ? "on" : "off");
    } catch {
      // Private windows: pairing still works until the tab closes.
    }
    if (!on) {
      sharedId.current = null;
      void fetch("/api/pair", { method: "DELETE" }).catch(() => setReachable(false));
    }
  }, []);

  return { enabled, setEnabled, reachable, activity: activity[active.id] ?? [] };
}
