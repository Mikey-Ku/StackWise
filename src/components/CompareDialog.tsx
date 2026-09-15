"use client";

import { useEffect, useMemo, useRef } from "react";
import { alternativesFor, costLine, inSentence, isStale, type SlotId } from "@/engine";
import type { PlanModel } from "./usePlans";
import { VerdictBadge, formatFactValue } from "./ui";

export interface CompareRequest {
  slot: SlotId;
  optionIds: string[];
}

export function CompareDialog({ model, request, today, onClose, onToast }: { model: PlanModel; request: CompareRequest | null; today: string; onClose: () => void; onToast: (m: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { index, input, rec, catalog } = model;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  const columns = useMemo(() => {
    if (!request) return [];
    const alts = alternativesFor(index, input, rec.selection, request.slot);
    return request.optionIds.flatMap((id) => {
      const alt = alts.find((a) => a.option.id === id);
      return alt ? [alt] : [];
    });
  }, [request, index, input, rec.selection]);

  const slotDef = request ? index.slotsById.get(request.slot) : undefined;
  const factKeys = slotDef ? [...new Set([...slotDef.required_facts, ...columns.flatMap((c) => Object.keys(c.option.facts))])] : [];

  return (
    <dialog ref={ref} className="mk-modal ws-spec" onClose={onClose}>
      <div className="mk-modal__body mk-stack mk-gap-4">
        <div className="mk-row mk-gap-3">
          <div className="mk-grow mk-stack mk-gap-1">
            <span className="mk-eyebrow">Compare {slotDef ? inSentence(slotDef.label) : ""}</span>
            <h3>Side by side, with your plan</h3>
          </div>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={onClose}>
            Close
          </button>
        </div>
        {request && slotDef && (
          <div className="mk-table-wrap ws-compare-wrap">
            <table className="mk-table ws-compare-grid">
              <thead>
                <tr>
                  <th />
                  {columns.map((c) => (
                    <th key={c.option.id}>
                      {c.option.name}
                      {rec.selection[request.slot] === c.option.id && <span className="mk-badge mk-badge--accent ws-ml">In plan</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ws-compare-grid__label">What it is</td>
                  {columns.map((c) => (
                    <td key={c.option.id}>{c.option.summary}</td>
                  ))}
                </tr>
                <tr>
                  <td className="ws-compare-grid__label">With your plan</td>
                  {columns.map((c) => (
                    <td key={c.option.id}>
                      <VerdictBadge level={c.worst} short />
                      {c.results
                        .filter((r) => r.level !== "info")
                        .map((r) => (
                          <div key={r.key} className="mk-hint">
                            {r.title}
                          </div>
                        ))}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="ws-compare-grid__label">Cost at your size</td>
                  {columns.map((c) => (
                    <td key={c.option.id}>{costLine(index, c.option, request.slot, input).headline}</td>
                  ))}
                </tr>
                <tr>
                  <td className="ws-compare-grid__label">Plan score if used</td>
                  {columns.map((c) => (
                    <td key={c.option.id} className="mk-num">
                      {c.delta >= 0 ? "+" : ""}
                      {c.delta.toFixed(1)}
                    </td>
                  ))}
                </tr>
                {factKeys.map((key) => (
                  <tr key={key}>
                    <td className="ws-compare-grid__label">{catalog.facts[key]?.label ?? key}</td>
                    {columns.map((c) => {
                      const fact = c.option.facts[key];
                      return (
                        <td key={c.option.id}>
                          {fact ? (
                            <>
                              <strong>{formatFactValue(index, catalog.facts[key], fact.value)}</strong>
                              <div className="mk-hint">{fact.note}</div>
                              <div className="mk-hint">
                                <a href={fact.source} target="_blank" rel="noreferrer">
                                  Source
                                </a>
                                , {fact.retrieved}
                                {isStale(fact, today) ? ", may be out of date" : ""}
                              </div>
                            </>
                          ) : (
                            <span className="mk-hint">Not researched</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td />
                  {columns.map((c) => (
                    <td key={c.option.id}>
                      {rec.selection[request.slot] !== c.option.id && (
                        <button
                          type="button"
                          className="mk-btn mk-btn--secondary mk-sm"
                          onClick={() => {
                            const error = model.place(c.option.id, request.slot);
                            if (error) onToast(error);
                            else onClose();
                          }}
                        >
                          Use {c.option.name}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </dialog>
  );
}
