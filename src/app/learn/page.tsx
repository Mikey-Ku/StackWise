import type { Metadata } from "next";
import { loadCatalog } from "@/engine/load";
import { LearnView, type LearnPart, type LearnTerm } from "./LearnView";
import "./learn.css";

// Read /data on every request, like the planner, so edits to learn.json show up on refresh.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Learn | StackWise",
  description: "Every part of a web app in plain words: what it does, how to choose one, the mistakes beginners make, and where to read more.",
};

/**
 * The Learn page: the teaching content from data/learn.json as a docs-style page. Deep links are
 * `/learn#part-<slotId>`, `/learn#term-<termId>` and `/learn#start-here`.
 */
export default function LearnPage() {
  const catalog = loadCatalog();
  const { learn } = catalog;

  const parts: LearnPart[] = catalog.slots.flatMap((slot) => {
    const entry = learn.slots[slot.id];
    return entry ? [{ id: slot.id, label: slot.label, ...entry }] : [];
  });

  // Each term lists the parts that use it, so the glossary links back to them.
  const terms: LearnTerm[] = Object.entries(learn.terms)
    .map(([id, t]) => ({ id, ...t, usedIn: parts.filter((p) => p.terms.includes(id)).map((p) => ({ id: p.id, label: p.label })) }))
    .sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }));

  const sources = new Set(
    [...(learn.start_here?.read_more ?? []), ...parts.flatMap((p) => p.read_more), ...terms.flatMap((t) => t.read_more)].map((link) => link.source),
  );

  return <LearnView startHere={learn.start_here ?? null} parts={parts} terms={terms} sourceCount={sources.size} />;
}
