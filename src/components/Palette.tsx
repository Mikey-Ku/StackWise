"use client";

import { useMemo, useState } from "react";
import { evaluatePlan, worstLevel, type Option, type SlotId } from "@/engine";
import type { PlanModel } from "./usePlan";
import { VERDICT_UI, VerdictDot, cx, type Verdict } from "./ui";

export function Palette({
  plan,
  onDragStart,
  onDragEnd,
  onToast,
}: {
  plan: PlanModel;
  onDragStart: (optionId: string) => void;
  onDragEnd: () => void;
  onToast: (message: string) => void;
}) {
  const { catalog, index, rec, input } = plan;
  const [query, setQuery] = useState("");

  // What would happen if each option were dropped into its slot right now.
  const previews = useMemo(() => {
    const map = new Map<string, Verdict>();
    for (const option of catalog.options) {
      const slot = option.slots[0];
      const swapped = { ...rec.selection, [slot]: option.id };
      const touching = evaluatePlan(index, swapped, input).filter((r) => r.slots.includes(slot) && r.source !== "missing");
      map.set(option.id, worstLevel(touching));
    }
    return map;
  }, [catalog.options, index, input, rec.selection]);

  const q = query.trim().toLowerCase();
  const matches = (o: Option) => !q || `${o.name} ${o.summary} ${o.provider}`.toLowerCase().includes(q);

  return (
    <div className="ws-palette">
      <div className="ws-palette__top">
        <input className="mk-input mk-sm" type="search" placeholder={`Search ${catalog.options.length} options`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="mk-hint">Drag onto the canvas, or press Use. The dot shows what would happen with the rest of your plan.</p>
      </div>
      {catalog.slots.map((slot) => {
        const options = catalog.options
          .filter((o) => o.slots.includes(slot.id) && matches(o))
          .sort((a, b) => Number(a.coverage === "partial") - Number(b.coverage === "partial") || a.name.localeCompare(b.name));
        if (options.length === 0) return null;
        return (
          <section key={slot.id} className="ws-group">
            <div className="ws-group__head">
              <span className="mk-eyebrow">{slot.id === "framework" ? "Framework (your app)" : slot.label}</span>
              <span className="mk-faint mk-num">{options.length}</span>
            </div>
            {options.map((option) => {
              const inPlan = rec.selection[slot.id as SlotId] === option.id;
              const preview = previews.get(option.id) ?? "works";
              return (
                <div
                  key={`${slot.id}-${option.id}`}
                  className={cx("ws-opt", inPlan && "is-in-plan")}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-whystack-option", option.id);
                    e.dataTransfer.effectAllowed = "move";
                    onDragStart(option.id);
                  }}
                  onDragEnd={onDragEnd}
                >
                  <div className="ws-opt__main">
                    <div className="ws-opt__name">
                      <VerdictDot level={preview} title={`If used: ${VERDICT_UI[preview].label}`} />
                      <span>{option.name}</span>
                      {inPlan && <span className="mk-badge mk-badge--accent">In plan</span>}
                      {option.coverage === "partial" && <span className="mk-badge ws-badge--unknown">Not verified</span>}
                    </div>
                    <p className="ws-opt__summary">{option.summary}</p>
                  </div>
                  <button
                    type="button"
                    className="mk-btn mk-btn--secondary mk-sm"
                    disabled={inPlan}
                    onClick={() => {
                      const error = plan.place(option.id, slot.id as SlotId);
                      if (error) onToast(error);
                    }}
                  >
                    Use
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
