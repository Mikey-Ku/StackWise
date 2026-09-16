"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { decodeSharedPlan, staleFacts, todayIso, type Catalog, type SlotId } from "@/engine";
import { ChecklistPanel } from "./ChecklistPanel";
import { ConnectionPanel } from "./ConnectionPanel";
import { ClaudePanel, PairDialog } from "./PairDialog";
import { CompareDialog, type CompareRequest } from "./CompareDialog";
import { Inspector } from "./Inspector";
import { LearnPanel } from "./LearnPanel";
import { Palette } from "./Palette";
import { PlanCanvas } from "./PlanCanvas";
import { PlanMenu } from "./PlanMenu";
import { Planner, type AiStatus } from "./Planner";
import { SpecDialog } from "./SpecDialog";
import { usePairing, type ClaudeActivity } from "./usePairing";
import { newId, usePlans } from "./usePlans";
import { cx } from "./ui";

type Tab = "options" | "details" | "learn" | "checklist" | "claude";
const TABS: { id: Tab; label: string }[] = [
  { id: "options", label: "Options" },
  { id: "details", label: "Details" },
  { id: "learn", label: "Learn" },
  { id: "checklist", label: "Checklist" },
  { id: "claude", label: "Claude" },
];

export default function Workspace({ catalog, problems }: { catalog: Catalog; problems: string[] }) {
  const model = usePlans(catalog);
  const { plan, dispatch, history } = model;
  const [tab, setTab] = useState<Tab>("options");
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(null);
  /** The part at the far end of the connection being looked at, when one is. */
  const [connection, setConnection] = useState<SlotId | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [specDate, setSpecDate] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareRequest | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const onClaudeChange = useCallback((appName: string, change: ClaudeActivity | undefined) => {
    const what = change ? `${change.summary}${change.changes.length ? `: ${change.changes.slice(0, 2).join("; ")}${change.changes.length > 2 ? ` (+${change.changes.length - 2})` : ""}` : ""}` : "updated the plan";
    setToast(`Claude changed ${appName.trim() || "your plan"}. ${what}. Undo reverses it.`);
  }, []);
  const pairing = usePairing({ history, dispatch, onClaudeChange });
  const leftRef = useRef<HTMLElement>(null);
  const today = useMemo(() => todayIso(), []);
  const stale = useMemo(() => staleFacts(catalog, today).length, [catalog, today]);

  useEffect(() => {
    leftRef.current?.scrollTo({ top: 0 });
  }, [plan.step, plan.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((status: AiStatus) => setAi(status))
      .catch(() => setAi({ ai: false, model: "" }));
  }, []);

  // Opening a share link imports the plan exactly once. The link is cleared from the address bar
  // before decoding, and the token is remembered, because development mode runs effects twice.
  const importedToken = useRef<string | null>(null);
  useEffect(() => {
    const match = window.location.hash.match(/^#plan=([A-Za-z0-9_-]+)$/);
    if (!match || importedToken.current === match[1]) return;
    importedToken.current = match[1];
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void decodeSharedPlan(match[1]).then((shared) => {
      if (!shared) {
        setToast("That share link is broken or incomplete.");
        return;
      }
      dispatch({ type: "importPlan", id: newId(), now: new Date().toISOString(), plan: shared });
      setToast(`Opened "${shared.appName || "a shared plan"}". It's saved as a new plan in this browser.`);
    });
  }, [dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      dispatch({ type: e.shiftKey ? "redo" : "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  const select = useCallback((slot: SlotId) => {
    setSelectedSlot(slot);
    setConnection(null);
    setTab("details");
  }, []);

  const selectConnection = useCallback((slot: SlotId) => {
    setSelectedSlot(slot);
    setConnection(slot);
    setTab("details");
  }, []);

  const researched = catalog.options.filter((o) => o.coverage === "full").length;
  const factCount = catalog.options.reduce((n, o) => n + Object.keys(o.facts).length, 0);
  const verified = catalog.options.reduce((n, o) => n + Object.values(o.facts).filter((f) => f.status === "verified").length, 0);

  return (
    <div className="ws">
      <header className="ws-top">
        <div className="mk-row mk-gap-3 ws-top__left">
          <span className="ws-mark">WhyStack</span>
          <span className="ws-top__sep" aria-hidden />
          <PlanMenu model={model} onToast={setToast} />
          <span className="mk-row mk-gap-1">
            <button type="button" className="mk-btn mk-btn--ghost mk-sm" disabled={history.past.length === 0} title="Undo (Cmd or Ctrl+Z)" onClick={() => dispatch({ type: "undo" })}>
              Undo
            </button>
            <button type="button" className="mk-btn mk-btn--ghost mk-sm" disabled={history.future.length === 0} title="Redo (Shift+Cmd or Ctrl+Z)" onClick={() => dispatch({ type: "redo" })}>
              Redo
            </button>
          </span>
        </div>
        <div className="mk-row mk-gap-3 ws-top__right">
          <button type="button" className={cx("mk-btn mk-sm", pairing.enabled ? "mk-btn--secondary ws-paired" : "mk-btn--ghost")} onClick={() => setPairOpen(true)} title="Plan together with Claude Code through WhyStack's MCP server">
            {pairing.enabled ? "Paired with Claude" : "Pair with Claude"}
          </button>
          <span className={cx("mk-badge", ai?.ai ? "mk-badge--accent" : "ws-badge--unknown")} title={ai?.ai ? `Model: ${ai.model}` : "Set ANTHROPIC_API_KEY in .env.local to turn on AI reading and explanations."}>
            {ai === null ? "AI ..." : ai.ai ? "AI on" : "AI off"}
          </span>
          <span className="mk-badge ws-badge--unknown ws-top__facts" title="Facts come from official sources and are drafts until a person reviews them.">
            {verified}/{factCount} facts reviewed · {researched}/{catalog.options.length} options researched{stale ? ` · ${stale} may be out of date` : ""}
          </span>
          <button type="button" className="mk-btn mk-btn--primary mk-sm" disabled={plan.step !== "plan"} onClick={() => setSpecDate(todayIso())}>
            Export project
          </button>
        </div>
      </header>

      {problems.length > 0 && (
        <div className="mk-alert mk-alert--danger ws-problems">
          <div>
            <strong>The data has {problems.length} problem{problems.length === 1 ? "" : "s"}.</strong> Run <code>pnpm check:data</code> for details. First: {problems[0]}
          </div>
        </div>
      )}

      <div className="ws-body">
        <aside className="ws-left" ref={leftRef}>
          <Planner model={model} ai={ai} onSelect={select} onOpenChecklist={() => setTab("checklist")} />
        </aside>

        <main className="ws-center">
          <ReactFlowProvider>
            <PlanCanvas
              model={model}
              selectedSlot={selectedSlot}
              selectedConnection={connection}
              dragging={dragging}
              showAll={showAll}
              onToggleShowAll={() => setShowAll((v) => !v)}
              onDropped={() => setDragging(null)}
              onSelect={select}
              onSelectConnection={selectConnection}
              onToast={setToast}
            />
          </ReactFlowProvider>
        </main>

        <aside className="ws-right">
          <div className="mk-tabs ws-right__tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={cx("mk-tab", tab === t.id && "ws-tab-on")} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="ws-right__body">
            {tab === "options" && <Palette model={model} selectedSlot={selectedSlot} onDragStart={setDragging} onDragEnd={() => setDragging(null)} onToast={setToast} />}
            {tab === "details" &&
              (connection ? (
                <ConnectionPanel model={model} slot={connection} today={today} onShowPart={() => setConnection(null)} onOpenChecklist={() => setTab("checklist")} onToast={setToast} />
              ) : (
                <Inspector model={model} slot={selectedSlot} today={today} onToast={setToast} onCompare={(slot, optionIds) => setCompare({ slot, optionIds })} onLearn={() => setTab("learn")} />
              ))}
            {tab === "learn" && <LearnPanel catalog={catalog} focus={selectedSlot} />}
            {tab === "checklist" && <ChecklistPanel model={model} today={today} onToast={setToast} />}
            {tab === "claude" && <ClaudePanel activity={pairing.activity} enabled={pairing.enabled} onOpenPairing={() => setPairOpen(true)} />}
          </div>
        </aside>
      </div>

      {toast && (
        <div className="ws-toast" role="status">
          {toast}
        </div>
      )}

      <SpecDialog model={model} generatedOn={specDate} whystackRoot={ai?.root} onClose={() => setSpecDate(null)} onToast={setToast} />
      <PairDialog open={pairOpen} enabled={pairing.enabled} reachable={pairing.reachable} onToggle={pairing.setEnabled} onClose={() => setPairOpen(false)} onToast={setToast} />
      <CompareDialog model={model} request={compare} today={today} onClose={() => setCompare(null)} onToast={setToast} />
    </div>
  );
}
