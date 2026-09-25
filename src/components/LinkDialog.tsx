"use client";

import { useEffect, useRef, useState } from "react";
import { LINK_KINDS, LINK_WORDS, linkId, linkVerdict, type LinkKind, type PlanLink } from "@/engine";
import type { PlanModel } from "./usePlans";
import { VERDICT_UI, VerdictDot, type Verdict } from "./ui";

/**
 * A line between two things in the plan, in the person's words: Stripe sends webhooks to the app,
 * the jobs service reads the database. The rules give it a verdict when a rule reads both parts;
 * otherwise it says "not checked", because nothing checked it.
 */

export interface LinkEdit {
  from: string;
  to: string;
  /** False for a line that isn't in the plan yet. */
  saved: boolean;
}

export function LinkDialog({
  edit,
  model,
  nameOf,
  onSave,
  onRemove,
  onClose,
}: {
  edit: LinkEdit | null;
  model: PlanModel;
  /** A readable name for an end: "the app", "Stripe", "Turso (cache)". */
  nameOf: (end: string) => string;
  onSave: (previousId: string | null, link: PlanLink) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { plan, index, rec, input } = model;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<LinkKind>("calls");
  const [what, setWhat] = useState("");
  const existing = edit?.saved ? plan.links[linkId(edit.from, edit.to)] : undefined;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (edit && !dialog.open) {
      setFrom(edit.from);
      setTo(edit.to);
      setKind(existing?.kind ?? "calls");
      setWhat(existing?.what ?? "");
      dialog.showModal();
    }
    if (!edit && dialog.open) dialog.close();
  }, [edit, existing]);

  const draft: PlanLink = { from, to, kind, ...(what.trim() ? { what: what.trim() } : {}) };
  const verdict = from && to ? linkVerdict(index, rec.results, draft, rec.selection, input) : null;
  const level = (verdict?.checked ? verdict.level : "unknown") as Verdict;

  return (
    <dialog ref={ref} className="mk-modal ws-custom" onClose={onClose}>
      <form
        className="mk-modal__body mk-stack mk-gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(edit?.saved ? linkId(edit.from, edit.to) : null, draft);
        }}
      >
        <div className="mk-stack mk-gap-1">
          <span className="mk-eyebrow">Line between two parts</span>
          <h3>
            {nameOf(from)} {LINK_WORDS[kind]} {nameOf(to)}
          </h3>
          <p className="mk-muted">Say how these two talk. It goes on the canvas and into the spec.</p>
        </div>
        <div className="mk-row mk-gap-2 mk-wrap">
          <label className="mk-field mk-grow">
            <span className="mk-label">How</span>
            <select className="mk-input" value={kind} onChange={(e) => setKind(e.target.value as LinkKind)}>
              {LINK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LINK_WORDS[k]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mk-btn mk-btn--ghost mk-sm ws-self-end"
            title="Swap which end starts it"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            Swap direction
          </button>
        </div>
        <label className="mk-field">
          <span className="mk-label">What travels</span>
          <input className="mk-input" value={what} maxLength={120} placeholder="payment events, user rows, daily report" onChange={(e) => setWhat(e.target.value)} />
        </label>
        <p className="mk-label">
          <VerdictDot level={level} /> {verdict?.checked ? VERDICT_UI[level].label : "Not checked: no rule reads these two parts"}
        </p>
        {verdict?.results
          .filter((r) => r.level !== "info")
          .map((r) => (
            <p key={r.key} className="mk-hint">
              {r.title}. {r.fix ?? r.explanation}
            </p>
          ))}
        <div className="mk-row mk-gap-2 mk-wrap">
          <button type="submit" className="mk-btn mk-btn--primary mk-sm">
            {existing ? "Save" : "Add the line"}
          </button>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={onClose}>
            Cancel
          </button>
          {existing && edit && (
            <button type="button" className="mk-btn mk-btn--ghost mk-sm ws-custom__remove" onClick={() => onRemove(linkId(edit.from, edit.to))}>
              Remove
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
