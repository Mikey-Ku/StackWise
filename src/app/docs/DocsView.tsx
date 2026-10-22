"use client";

import { useEffect, useState } from "react";
import { Shell, type Me, type ShellSections } from "@/components/Shell";

/**
 * The documentation, as a document: every Markdown file in the repo's docs, rendered in order on
 * one page, with the documents as sections in the sidebar and each document's headings under its
 * title. The hash picks a section (/docs#mcp), and the sidebar follows as you scroll.
 */

export interface Doc {
  id: string;
  title: string;
  file: string;
  html: string;
  headings: { id: string; text: string }[];
}

/** Past this many headings (the decisions, one per heading), the contents fold up behind a line. */
const MANY_HEADINGS = 16;

function Contents({ doc }: { doc: Doc }) {
  return (
    <nav className="doc__toc" aria-label={`In ${doc.title}`}>
      {doc.headings.map((h) => (
        <a key={h.id} href={`#${h.id}`}>
          {h.text}
        </a>
      ))}
    </nav>
  );
}

export default function DocsView({ me, docs, repo }: { me: Me | null; docs: Doc[]; repo: string }) {
  const [active, setActive] = useState<string>(docs[0]?.id ?? "overview");

  // The sidebar follows the section in view.
  useEffect(() => {
    const sections = docs.map((d) => document.getElementById(d.id)).filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen[0]) setActive(seen[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [docs]);

  const sidebar: ShellSections = { title: "Documentation", items: docs.map((d) => ({ id: d.id, label: d.title, href: `/docs#${d.id}`, active: active === d.id })) };

  return (
    <Shell me={me} sections={sidebar}>
      <div className="shell-head">
        <div className="mk-stack mk-gap-1">
          <h1 className="shell-title">Documentation</h1>
          <p className="mk-muted">
            The same files as in the repo, read from this copy of StackWise. Edit them on{" "}
            <a href={repo} target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
        </div>
      </div>
      {docs.map((doc) => (
        <section key={doc.id} id={doc.id} className="doc">
          <header className="doc__head">
            <h2 className="doc__title">{doc.title}</h2>
            <span className="doc__file">
              <code>{doc.file}</code>
            </span>
          </header>
          {doc.headings.length > 1 && doc.headings.length <= MANY_HEADINGS && <Contents doc={doc} />}
          {doc.headings.length > MANY_HEADINGS && (
            <details className="doc__contents">
              <summary>Contents, {doc.headings.length} headings</summary>
              <Contents doc={doc} />
            </details>
          )}
          {/* The repo's own Markdown, rendered on the server; nothing here comes from a person's input. */}
          <article className="doc__body" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </section>
      ))}
    </Shell>
  );
}
