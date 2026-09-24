"use client";

import { useEffect, useRef, useState } from "react";
import { customPartSchema, type CustomPart } from "@/engine";

/**
 * Adding a part StackWise doesn't list: a vector database, an internal API, a library. It goes on
 * the canvas and into the spec, but StackWise has no facts on it, so it's shown as not checked.
 */

export interface CustomEdit {
  /** null: a new part. */
  id: string | null;
  /** Prefilled name for a new part, from what was typed in the picker. */
  name?: string;
}

const splitNames = (text: string) => [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];

export function customId(name: string, taken: Record<string, unknown>): string {
  const base = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "part"}`;
  let id = base;
  for (let n = 2; id in taken; n++) id = `${base}-${n}`;
  return id;
}

export function CustomPartDialog({
  edit,
  custom,
  onSave,
  onRemove,
  onClose,
}: {
  edit: CustomEdit | null;
  custom: Record<string, CustomPart>;
  onSave: (id: string, part: CustomPart) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const existing = edit?.id ? custom[edit.id] : undefined;
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [url, setUrl] = useState("");
  const [env, setEnv] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (edit && !dialog.open) {
      setName(existing?.name ?? edit.name ?? "");
      setRole(existing?.role ?? "");
      setUrl(existing?.url ?? "");
      setEnv(existing?.env.join(", ") ?? "");
      setNote(existing?.note ?? "");
      setError(null);
      dialog.showModal();
    }
    if (!edit && dialog.open) dialog.close();
  }, [edit, existing]);

  const save = () => {
    const parsed = customPartSchema.safeParse({ name, role: role.trim(), url: url.trim(), env: splitNames(env), note });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue.path[0] === "name" ? "Give it a name." : issue.path[0] === "env" ? "Variable names use letters, numbers and _, like PINECONE_API_KEY." : "Check the fields and try again.");
      return;
    }
    if (parsed.data.url && !/^https?:\/\//.test(parsed.data.url)) {
      setError("The docs link should start with https://.");
      return;
    }
    onSave(edit?.id ?? customId(parsed.data.name, custom), parsed.data);
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
          <span className="mk-eyebrow">{existing ? "Your own part" : "Add a part that isn't listed"}</span>
          <h3>{existing ? `Edit ${existing.name}` : "What else does your app use?"}</h3>
          <p className="mk-muted">It goes on the canvas and into the spec. StackWise has no facts on it, so it isn&apos;t checked or priced.</p>
        </div>
        <label className="mk-field">
          <span className="mk-label">Name</span>
          <input className="mk-input" autoFocus value={name} maxLength={60} placeholder="Pinecone, our billing API, pdf-lib" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mk-field">
          <span className="mk-label">The app ___ it</span>
          <input className="mk-input" value={role} maxLength={80} placeholder="searches documents with" onChange={(e) => setRole(e.target.value)} />
          <span className="mk-hint">Shown on its line, like the other parts.</span>
        </label>
        <label className="mk-field">
          <span className="mk-label">Docs link</span>
          <input className="mk-input" type="url" value={url} maxLength={300} placeholder="https://docs.example.com" onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="mk-field">
          <span className="mk-label">Environment variables</span>
          <input className="mk-input ws-custom__env" value={env} placeholder="PINECONE_API_KEY, PINECONE_INDEX" spellCheck={false} onChange={(e) => setEnv(e.target.value)} />
          <span className="mk-hint">Names only. They join the checklist and .env.example; the values stay in your .env.local.</span>
        </label>
        <label className="mk-field">
          <span className="mk-label">Note</span>
          <textarea className="mk-input" rows={3} value={note} maxLength={4000} placeholder="How it's wired, what to watch" onChange={(e) => setNote(e.target.value)} />
        </label>
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
              Remove from the plan
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
