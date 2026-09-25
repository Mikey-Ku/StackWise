"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EXTRA_ID, worstLevel, type Extra, type SlotId } from "@/engine";
import type { PlanModel } from "./usePlans";
import { VERDICT_UI, VerdictDot, type Verdict } from "./ui";

/**
 * A second (third…) service in a part: a cache next to the main database, an embeddings model
 * next to the main AI. StackWise checks and prices it like the part's first service; the person
 * picks it, StackWise never does.
 */

export interface ExtraEdit {
  /** null: a new extra in `slot`. */
  id: string | null;
  slot: SlotId;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

export function ExtraDialog({ edit, model, onSave, onRemove, onClose }: { edit: ExtraEdit | null; model: PlanModel; onSave: (id: string, extra: Extra, previousId: string | null) => void; onRemove: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { catalog, index, rec, plan } = model;
  const existing = edit?.id ? plan.extras[edit.id] : undefined;
  const slot = edit?.slot ?? "database";
  const def = index.slotsById.get(slot);
  const choices = useMemo(() => catalog.options.filter((o) => o.slots.includes(slot)), [catalog.options, slot]);
  const [option, setOption] = useState("");
  const [role, setRole] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (edit && !dialog.open) {
      setOption(existing?.option ?? choices.find((o) => o.id !== rec.selection[slot])?.id ?? "");
      setRole(existing?.role ?? "");
      setNote(existing?.note ?? "");
      setError(null);
      dialog.showModal();
    }
    if (!edit && dialog.open) dialog.close();
  }, [edit, existing, choices, rec.selection, slot]);

  // What the rules say about this one right now, when it's already in the plan.
  const checks = edit?.id ? rec.results.filter((r) => r.instance === edit.id) : [];
  const level = worstLevel(checks) as Verdict;

  const save = () => {
    const name = slug(role) || "second";
    const id = edit?.id ?? `${slot}.${name}`;
    if (!EXTRA_ID.test(id)) return setError("Give it a short name, like cache or embeddings.");
    if (!edit?.id && plan.extras[id]) return setError(`There's already a ${def?.label.toLowerCase()} called ${name}.`);
    if (!option) return setError("Pick a service.");
    onSave(id, { slot, option, role: role.trim() || name, ...(note.trim() ? { note: note.trim() } : {}) }, edit?.id ?? null);
  };

  return (
    <dialog ref={ref} className="mk-modal ws-custom" onClose={onClose}>
      <form
        className="mk-modal__body mk-stack mk-gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="mk-stack mk-gap-1">
          <span className="mk-eyebrow">{def?.label}</span>
          <h3>{existing ? `Edit your ${role || "extra"} ${def?.label.toLowerCase()}` : `Add another service for ${def?.label.toLowerCase()}`}</h3>
          <p className="mk-muted">For a second job, like a cache next to your database. StackWise checks it and adds its cost, like any other part.</p>
        </div>
        <label className="mk-field">
          <span className="mk-label">Service</span>
          <select className="mk-input" value={option} onChange={(e) => setOption(e.target.value)}>
            {choices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.id === rec.selection[slot] ? " (already your main one)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="mk-field">
          <span className="mk-label">What it&apos;s for</span>
          <input className="mk-input" autoFocus value={role} maxLength={40} placeholder="cache, embeddings, analytics warehouse" onChange={(e) => setRole(e.target.value)} />
        </label>
        <label className="mk-field">
          <span className="mk-label">Note</span>
          <textarea className="mk-input" rows={3} value={note} maxLength={4000} placeholder="What goes in it, how the app reaches it" onChange={(e) => setNote(e.target.value)} />
        </label>
        {edit?.id && (
          <div className="mk-stack mk-gap-1">
            <span className="mk-label">
              <VerdictDot level={level} /> {VERDICT_UI[level].label}
            </span>
            {checks.filter((r) => r.level !== "info").map((r) => (
              <p key={r.key} className="mk-hint">
                {r.title}. {r.fix ?? r.explanation}
              </p>
            ))}
          </div>
        )}
        {error && <p className="ws-proj__error">{error}</p>}
        <div className="mk-row mk-gap-2 mk-wrap">
          <button type="submit" className="mk-btn mk-btn--primary mk-sm">
            {existing ? "Save" : "Add to the plan"}
          </button>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={onClose}>
            Cancel
          </button>
          {existing && edit?.id && (
            <button type="button" className="mk-btn mk-btn--ghost mk-sm ws-custom__remove" onClick={() => onRemove(edit.id!)}>
              Remove
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
