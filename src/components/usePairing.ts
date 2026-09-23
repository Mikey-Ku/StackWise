"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedPlan, SlotId } from "@/engine";
import type { AgentState } from "@/mcp/pairing";
import type { Message } from "@/mcp/registry";
import { toSharedPlan, type History, type PlanState, type StoreAction } from "./store";

/**
 * Pairing with coding agents from the browser side. When sharing is on, the plan you have open is
 * shared with StackWise's server, where an agent's MCP tools read and change it. Whether or not
 * it's on, the tab keeps asking the server what agents did and said, so changes from a paired
 * session or an exported project show up here as undoable steps, and their answers show up in
 * the Ask panel. Writing to an agent turns sharing on, since the agent can only read a shared plan.
 */

export interface ClaudeActivity {
  id: string;
  at: string;
  tool: string;
  summary: string;
  changes: string[];
  verdict?: string;
}

export type AgentMessage = Message;
export type Agent = AgentState;

interface SharedRecord {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy: "browser" | "claude";
  plan: SharedPlan;
  activity: ClaudeActivity[];
  messages?: Message[];
  agents?: Record<string, AgentState>;
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
  const [records, setRecords] = useState<Record<string, Pick<SharedRecord, "activity" | "messages" | "agents">>>({});
  const [reachable, setReachable] = useState<boolean | null>(null);
  /** The server's clock at the last look, so presence doesn't depend on this computer's clock. */
  const [serverNow, setServerNow] = useState(() => Date.now());
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

  // Ask the server what agents changed, did or said since the last look.
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const response = await fetch(`/api/pair?since=${encodeURIComponent(since.current)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { now: string; records: SharedRecord[] };
        since.current = body.now;
        // Presence only needs a coarse clock; updating it every poll would re-render the workspace every 1.5 seconds.
        const serverTime = Date.parse(body.now);
        setServerNow((previous) => (Math.abs(serverTime - previous) >= 5000 ? serverTime : previous));
        setReachable(true);
        if (body.records.length) {
          setRecords((previous) => ({ ...previous, ...Object.fromEntries(body.records.map((r) => [r.id, { activity: r.activity, messages: r.messages ?? [], agents: r.agents ?? {} }])) }));
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

  /** Put a plan on the server. False when the server couldn't be reached. */
  const share = useCallback(
    async (plan: PlanState): Promise<boolean> => {
      const shared = toSharedPlan(plan);
      const json = JSON.stringify(shared);
      try {
        const response = await fetch("/api/pair", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: plan.id, plan: shared, baseVersion: known.current[plan.id] ?? 0 }),
        });
        if (response.status === 409) {
          applyRecord(((await response.json()) as { record: SharedRecord }).record);
          sharedId.current = plan.id;
          return true;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { version } = (await response.json()) as { version: number };
        known.current[plan.id] = version;
        synced.current[plan.id] = json;
        sharedId.current = plan.id;
        setReachable(true);
        return true;
      } catch {
        setReachable(false);
        return false;
      }
    },
    [applyRecord],
  );

  // Share the open plan whenever it changes, or when you switch plans.
  useEffect(() => {
    if (!enabled) return;
    const json = JSON.stringify(toSharedPlan(active));
    if (synced.current[active.id] === json && sharedId.current === active.id) return;
    const timer = window.setTimeout(() => void share(active), 400);
    return () => window.clearTimeout(timer);
  }, [enabled, active, share]);

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

  /** Write to one agent. The message waits in the shared plan's inbox until that agent picks it up. */
  const send = useCallback(
    async (agent: string, text: string, about: SlotId): Promise<string | null> => {
      if (!enabled) setEnabled(true);
      if (sharedId.current !== active.id && !(await share(active))) return "Couldn't reach StackWise's server, so the message wasn't sent.";
      try {
        const response = await fetch("/api/pair", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: active.id, agent, text, about, planVersion: known.current[active.id] }),
        });
        const body = (await response.json()) as { message?: Message; error?: string };
        if (!response.ok || !body.message) return body.error ?? `The message wasn't sent (HTTP ${response.status}).`;
        const message = body.message;
        setRecords((previous) => {
          const current = previous[active.id] ?? { activity: [], messages: [], agents: {} };
          return { ...previous, [active.id]: { ...current, messages: [...(current.messages ?? []), message] } };
        });
        return null;
      } catch {
        return "Couldn't reach StackWise's server, so the message wasn't sent.";
      }
    },
    [enabled, setEnabled, share, active],
  );

  const record = records[active.id];
  return {
    enabled,
    setEnabled,
    reachable,
    serverNow,
    send,
    activity: record?.activity ?? [],
    messages: record?.messages ?? [],
    agents: record?.agents ?? {},
  };
}

export type Pairing = ReturnType<typeof usePairing>;
