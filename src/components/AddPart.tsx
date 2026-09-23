"use client";

import { useMemo, useRef, useState } from "react";
import { evaluatePlan, worstLevel, type Option, type SlotId } from "@/engine";
import { Icon } from "./icons";
import type { PlanModel } from "./usePlans";
import { Logo, VERDICT_UI, VerdictDot, cx, type Verdict } from "./ui";

/**
 * Adding a part, the way n8n adds a node: a search box over every option, grouped by part, with a
 * dot for what would happen if it went into the plan right now. Enter or a click puts it on the
 * canvas, where its line to the app shows the verdict straight away. Opened with the + in the
 * dock, the + on the app card, "Add a part" on a right-click, or the A key.
 */

interface Row {
  option: Option;
  slot: SlotId;
  label: string;
  inPlan: boolean;
  verdict: Verdict;
}

export function AddPart({ model, focus, onClose, onAdded }: { model: PlanModel; focus: SlotId | null; onClose: () => void; onAdded: (slot: SlotId, name: string, error: string | null) => void }) {
  const { catalog, index, rec, input } = model;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // What each option would do to the plan, checked by the rules, for the dot next to it.
  const rows = useMemo(() => {
    const all: Row[] = [];
    for (const slot of catalog.slots) {
      for (const option of catalog.options.filter((o) => o.slots.includes(slot.id))) {
        const touching = evaluatePlan(index, { ...rec.selection, [slot.id]: option.id }, input).filter((r) => r.slots.includes(slot.id) && r.source !== "missing");
        all.push({ option, slot: slot.id, label: slot.id === "framework" ? "Framework" : slot.label, inPlan: rec.selection[slot.id] === option.id, verdict: worstLevel(touching) });
      }
    }
    return all;
  }, [catalog, index, rec.selection, input]);

  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => !q || `${r.option.name} ${r.label} ${r.option.summary} ${r.option.provider}`.toLowerCase().includes(q))
    // The part being looked at first, then parts the plan doesn't have yet, then the rest.
    .sort((a, b) => Number(b.slot === focus) - Number(a.slot === focus) || Number(Boolean(rec.selection[a.slot])) - Number(Boolean(rec.selection[b.slot])));
  const groups = [...new Set(shown.map((r) => r.slot))];
  const flat = groups.flatMap((slot) => shown.filter((r) => r.slot === slot));
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  const pick = (row: Row | undefined) => {
    if (!row || row.inPlan) return;
    const error = model.place(row.option.id, row.slot);
    onAdded(row.slot, row.option.name, error);
    if (!error) onClose();
  };

  const move = (delta: number) => {
    const next = Math.max(0, Math.min(flat.length - 1, current + delta));
    setActive(next);
    listRef.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="ws-add-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="ws-add" role="dialog" aria-label="Add a part">
        <div className="ws-add__search">
          <Icon name="plus" size={16} />
          <input
            autoFocus
            value={query}
            placeholder={`Add a part: search ${catalog.options.length} services, like Stripe, email or a database`}
            aria-label="Search parts and services"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") move(1);
              else if (e.key === "ArrowUp") move(-1);
              else if (e.key === "Enter") pick(flat[current]);
              else if (e.key === "Escape") onClose();
              else return;
              e.preventDefault();
            }}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="ws-add__list" ref={listRef} role="listbox">
          {flat.length === 0 && <li className="ws-add__empty">Nothing matches &ldquo;{query}&rdquo;.</li>}
          {groups.map((slot) => {
            const inGroup = flat.filter((r) => r.slot === slot);
            return (
              <li key={slot} role="presentation">
                <span className="ws-add__group">
                  {inGroup[0].label}
                  {rec.selection[slot] ? "" : rec.needed.includes(slot) ? " · your plan needs one" : " · not in your plan"}
                </span>
                <ul role="presentation">
                  {inGroup.map((row) => {
                    const n = flat.indexOf(row);
                    return (
                      <li key={`${row.slot}-${row.option.id}`} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={n === current}
                          data-row={n}
                          disabled={row.inPlan}
                          className={cx("ws-add__row", n === current && "is-active")}
                          onMouseEnter={() => setActive(n)}
                          onClick={() => pick(row)}
                        >
                          <Logo logo={catalog.logos[row.option.id]} name={row.option.name} size={26} />
                          <span className="ws-add__text">
                            <strong>{row.option.name}</strong>
                            <span>{row.option.summary}</span>
                          </span>
                          {row.inPlan ? <span className="ws-add__tag">In plan</span> : <VerdictDot level={row.verdict} title={`If added: ${VERDICT_UI[row.verdict].label}`} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
        <p className="ws-add__foot">
          <span>
            <kbd>&uarr;</kbd> <kbd>&darr;</kbd> to move, <kbd>enter</kbd> to add
          </span>
          <span>The dot is what StackWise&apos;s rules say it would do to your plan.</span>
        </p>
      </section>
    </div>
  );
}
