"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { Catalog, SlotId } from "@/engine";
import { Inspector } from "./Inspector";
import { Palette } from "./Palette";
import { PlanCanvas } from "./PlanCanvas";
import { Planner } from "./Planner";
import { SpecDialog } from "./SpecDialog";
import { usePlan } from "./usePlan";
import { cx } from "./ui";

export default function Workspace({ catalog, problems }: { catalog: Catalog; problems: string[] }) {
  const plan = usePlan(catalog);
  const { state, dispatch } = plan;
  const [tab, setTab] = useState<"options" | "details">("options");
  const [dragging, setDragging] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [specDate, setSpecDate] = useState<string | null>(null);
  const leftRef = useRef<HTMLElement>(null);

  // A new step starts at the top of the planner.
  useEffect(() => {
    leftRef.current?.scrollTo({ top: 0 });
  }, [state.step]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const select = useCallback(
    (slot: SlotId) => {
      dispatch({ type: "select", slot });
      setTab("details");
    },
    [dispatch],
  );

  const researched = catalog.options.filter((o) => o.coverage === "full").length;
  const factCount = catalog.options.reduce((n, o) => n + Object.keys(o.facts).length, 0);
  const verified = catalog.options.reduce((n, o) => n + Object.values(o.facts).filter((f) => f.status === "verified").length, 0);

  return (
    <div className="ws">
      <header className="ws-top">
        <div className="mk-row mk-gap-3">
          <span className="ws-mark">WhyStack</span>
          <span className="ws-top__sep" aria-hidden />
          <span className="mk-muted ws-top__app">{state.appName.trim() || "Untitled app"}</span>
        </div>
        <div className="mk-row mk-gap-3">
          <span className="mk-badge ws-badge--unknown" title="Facts come from official sources and are drafts until a person reviews them.">
            {verified}/{factCount} facts reviewed · {researched} of {catalog.options.length} options researched
          </span>
          <button
            type="button"
            className="mk-btn mk-btn--ghost mk-sm"
            onClick={() => {
              if (window.confirm("Start over? This clears your description, answers and choices.")) dispatch({ type: "reset" });
            }}
          >
            Start over
          </button>
          <button type="button" className="mk-btn mk-btn--primary mk-sm" disabled={state.step !== "plan"} onClick={() => setSpecDate(new Date().toISOString().slice(0, 10))}>
            Export spec pack
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
          <Planner plan={plan} />
        </aside>

        <main className="ws-center">
          <ReactFlowProvider>
            <PlanCanvas plan={plan} dragging={dragging} onDropped={() => setDragging(null)} onSelect={select} onToast={setToast} />
          </ReactFlowProvider>
        </main>

        <aside className="ws-right">
          <div className="mk-tabs ws-right__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "options"} className={cx("mk-tab", tab === "options" && "ws-tab-on")} onClick={() => setTab("options")}>
              Options
            </button>
            <button type="button" role="tab" aria-selected={tab === "details"} className={cx("mk-tab", tab === "details" && "ws-tab-on")} onClick={() => setTab("details")}>
              Details
            </button>
          </div>
          <div className="ws-right__body">
            {tab === "options" ? (
              <Palette plan={plan} onDragStart={setDragging} onDragEnd={() => setDragging(null)} onToast={setToast} />
            ) : (
              <Inspector plan={plan} onToast={setToast} />
            )}
          </div>
        </aside>
      </div>

      {toast && (
        <div className="ws-toast" role="status">
          {toast}
        </div>
      )}

      <SpecDialog plan={plan} generatedOn={specDate} onClose={() => setSpecDate(null)} />
    </div>
  );
}
