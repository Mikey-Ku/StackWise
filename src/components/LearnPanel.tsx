"use client";

import { useState } from "react";
import type { Catalog, SlotId } from "@/engine";

/** The teaching layer: what each part of an app is, how to choose one, and the words people use. */
export function LearnPanel({ catalog, focus }: { catalog: Catalog; focus: SlotId | null }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const terms = Object.entries(catalog.learn.terms)
    .filter(([id, t]) => !q || `${id} ${t.term} ${t.plain} ${t.matters}`.toLowerCase().includes(q))
    .sort((a, b) => a[1].term.localeCompare(b[1].term));
  const parts = catalog.slots.flatMap((slot) => {
    const entry = catalog.learn.slots[slot.id];
    const matches = entry && (!q || `${slot.label} ${entry.what} ${entry.why} ${entry.choosing.join(" ")} ${entry.watch_for.join(" ")}`.toLowerCase().includes(q));
    return matches ? [{ slot, entry }] : [];
  });

  const jump = (id: string) => {
    setQuery("");
    requestAnimationFrame(() => document.getElementById(`term-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="ws-learn">
      <div className="ws-palette__top">
        <input className="mk-input mk-sm" type="search" placeholder="Search parts and terms" value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="mk-hint">Every part of a web app, in plain words, and what to watch for when you pick one.</p>
      </div>

      <section className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Parts of an app</span>
        {parts.map(({ slot, entry }) => {
          return (
            <details key={slot.id} className="ws-learn-part" open={focus === slot.id || Boolean(q)}>
              <summary>{slot.label}</summary>
              <div className="mk-stack mk-gap-2">
                <p>{entry.what}</p>
                <p className="mk-muted">{entry.why}</p>
                <p className="mk-label">What matters when choosing</p>
                <ul>{entry.choosing.map((line) => <li key={line}>{line}</li>)}</ul>
                <p className="mk-label">Where beginners slip</p>
                <ul>{entry.watch_for.map((line) => <li key={line}>{line}</li>)}</ul>
                <div className="ws-chips">
                  {entry.terms.map((id) => (
                    <button key={id} type="button" className="ws-chip ws-chip--small" onClick={() => jump(id)}>
                      {catalog.learn.terms[id]?.term ?? id}
                    </button>
                  ))}
                </div>
              </div>
            </details>
          );
        })}
      </section>

      <section className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Words you&apos;ll see</span>
        {terms.map(([id, t]) => (
          <div key={id} id={`term-${id}`} className="ws-term">
            <strong>{t.term}</strong>
            <p>{t.plain}</p>
            <p className="mk-muted">{t.matters}</p>
          </div>
        ))}
        {terms.length === 0 && parts.length === 0 && <p className="mk-muted">Nothing matches &ldquo;{query}&rdquo;.</p>}
      </section>
    </div>
  );
}
