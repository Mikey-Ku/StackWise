"use client";

import { useEffect, useState } from "react";
import { inSentence, isOwn, type SlotId } from "@/engine";
import type { PlanModel } from "./usePlans";

/**
 * The person's note on one part of the plan. It saves as they type (not undoable, like any text
 * field), travels with the plan, and warns when it was written for an option that's since been
 * swapped out. Claude can suggest a note from the Ask panel; accepting one is undoable.
 */

const now = () => new Date().toISOString();

export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function NoteEditor({ model, slot }: { model: PlanModel; slot: SlotId }) {
  const { plan, rec, index, dispatch } = model;
  const note = plan.notes[slot];
  const saved = note?.text ?? "";
  /** What's being typed. Null when the editor shows the saved note, so changes from Claude or undo appear. */
  const [draft, setDraft] = useState<string | null>(null);
  const optionId = rec.selection[slot] || undefined;
  const option = optionId ? index.optionsById.get(optionId) : undefined;
  const writtenFor = note?.optionId && optionId && note.optionId !== optionId ? (index.optionsById.get(note.optionId)?.name ?? note.optionId) : undefined;
  const value = draft ?? saved;
  const own = isOwn(option?.id);
  const subject = option && !own ? option.name : own ? `your own ${(index.slotsById.get(slot)?.label ?? slot).toLowerCase()}` : inSentence(index.slotsById.get(slot)?.label ?? slot);

  useEffect(() => {
    if (draft === null || draft === saved) return;
    const timer = window.setTimeout(() => dispatch({ type: "editNote", slot, text: draft, optionId, at: now() }), 400);
    return () => window.clearTimeout(timer);
  }, [draft, saved, slot, optionId, dispatch]);

  return (
    <section className="ws-sec">
      <div className="ws-sec__head">
        <span className="mk-eyebrow">Note</span>
        {note && (
          <span className="mk-hint">
            {note.by === "claude" ? "Written by AI" : "Saved"}, {ago(note.updatedAt)}
          </span>
        )}
      </div>
      {writtenFor && (
        <div className="ws-work__stale">
          <span>
            Written when this was {writtenFor}. Check that it still applies to {option?.name ?? "the new choice"}.
          </span>
          <button type="button" className="ws-link" onClick={() => dispatch({ type: "editNote", slot, text: saved, optionId, at: now() })}>
            It still applies
          </button>
        </div>
      )}
      <textarea
        className="mk-textarea ws-work__note"
        aria-label={`Note on ${subject}`}
        value={value}
        rows={Math.min(10, Math.max(3, value.split("\n").length + 1))}
        placeholder={own ? `What is ${subject}, and how does the app reach it? Whoever builds it reads this.` : `How should ${subject} work in your app? Whoever builds it reads this.`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== saved) dispatch({ type: "editNote", slot, text: draft, optionId, at: now() });
          setDraft(null);
        }}
      />
    </section>
  );
}
