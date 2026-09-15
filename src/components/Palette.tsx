"use client";

import { useMemo, useState } from "react";
import { cardStats, evaluatePlan, optionStats, worstLevel, type Option, type SlotId, type Stat } from "@/engine";
import type { PlanModel } from "./usePlans";
import { Logo, StatChips, VERDICT_UI, cx, type Verdict } from "./ui";

export function Palette({
  model,
  selectedSlot,
  onDragStart,
  onDragEnd,
  onToast,
}: {
  model: PlanModel;
  selectedSlot: SlotId | null;
  onDragStart: (optionId: string) => void;
  onDragEnd: () => void;
  onToast: (message: string) => void;
}) {
  const { catalog, index, rec, input } = model;
  const [query, setQuery] = useState("");
  const [onlyNeeded, setOnlyNeeded] = useState(false);

  // What would happen if each option were dropped into each slot it fits, right now.
  const previews = useMemo(() => {
    const map = new Map<string, Verdict>();
    for (const option of catalog.options) {
      for (const slot of option.slots) {
        const swapped = { ...rec.selection, [slot]: option.id };
        const touching = evaluatePlan(index, swapped, input).filter((r) => r.slots.includes(slot) && r.source !== "missing");
        map.set(`${slot}:${option.id}`, worstLevel(touching));
      }
    }
    return map;
  }, [catalog.options, index, input, rec.selection]);

  // Cost and key facts for each option in each slot, at the audience size in the plan.
  const stats = useMemo(() => {
    const map = new Map<string, Stat[]>();
    for (const option of catalog.options) {
      for (const slot of option.slots) map.set(`${slot}:${option.id}`, cardStats(optionStats(index, option, slot, input)));
    }
    return map;
  }, [catalog.options, index, input]);

  const q = query.trim().toLowerCase();
  const matches = (o: Option) => !q || `${o.name} ${o.summary} ${o.provider}`.toLowerCase().includes(q);
  const slots = catalog.slots.filter((s) => !onlyNeeded || rec.needed.includes(s.id) || rec.selection[s.id]);

  return (
    <div className="ws-palette">
      <div className="ws-palette__top">
        <input className="mk-input mk-sm" type="search" placeholder={`Search ${catalog.options.length} options`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="mk-check">
          <input type="checkbox" checked={onlyNeeded} onChange={(e) => setOnlyNeeded(e.target.checked)} />
          Only parts my plan uses
        </label>
        <p className="mk-hint">Drag onto the canvas, or press Use. The dot on each logo shows what would happen with the rest of your plan. Costs are for the audience size in your plan.</p>
      </div>
      {slots.map((slot) => {
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
              const inPlan = rec.selection[slot.id] === option.id;
              const preview = previews.get(`${slot.id}:${option.id}`) ?? "works";
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
                  <Logo logo={catalog.logos[option.id]} name={option.name} size={32} status={{ level: preview, title: `If used: ${VERDICT_UI[preview].label}` }} />
                  <div className="ws-opt__name">
                    <span>{option.name}</span>
                    {inPlan && <span className="mk-badge mk-badge--accent">In plan</span>}
                    {option.coverage === "partial" && <span className="mk-badge ws-badge--unknown">Not verified</span>}
                  </div>
                  <p className="ws-opt__summary">{option.summary}</p>
                  <StatChips stats={stats.get(`${slot.id}:${option.id}`) ?? []} className="ws-opt__stats" />
                  <button
                    type="button"
                    className="mk-btn mk-btn--secondary mk-sm"
                    disabled={inPlan}
                    onClick={() => {
                      const error = model.place(option.id, slot.id, selectedSlot);
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
