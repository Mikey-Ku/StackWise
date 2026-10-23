"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Shell, type Me, type ShellSections } from "@/components/Shell";
import type { Learn, LearnLink, SlotId } from "@/engine/schema";

/**
 * The documentation, as one document. First how a web app fits together, in plain words, from
 * data/learn.json (start here, the parts of an app, the glossary); then the repo's own Markdown
 * docs. Every section has the same shape: a title, the file it comes from, its headings as chips,
 * the body. The sidebar lists the sections in two groups and follows the one in view. The hash
 * picks a section (/docs#mcp), a part (#part-database) or a term (#term-api).
 */

type SlotEntry = NonNullable<Learn["slots"][SlotId]>;
export type LearnPart = SlotEntry & { id: SlotId; label: string };
export type LearnTerm = Learn["terms"][string] & { id: string; usedIn: { id: SlotId; label: string }[] };
export type StartHere = NonNullable<Learn["start_here"]>;
export interface LearnContent {
  startHere: StartHere | null;
  parts: LearnPart[];
  terms: LearnTerm[];
}

export interface Doc {
  id: string;
  title: string;
  file: string;
  html: string;
  headings: { id: string; text: string }[];
}

type Heading = { id: string; text: string };

/** Past this many headings (the decisions, the glossary), the contents fold up behind a line. */
const MANY_HEADINGS = 16;
const LEARN_FILE = "data/learn.json";

function Contents({ headings, label, noun = "headings" }: { headings: Heading[]; label: string; noun?: string }) {
  if (headings.length < 2) return null;
  const nav = (
    <nav className="doc__toc" aria-label={label}>
      {headings.map((h) => (
        <a key={h.id} href={`#${h.id}`}>
          {h.text}
        </a>
      ))}
    </nav>
  );
  if (headings.length <= MANY_HEADINGS) return nav;
  return (
    <details className="doc__contents">
      <summary>
        Contents, {headings.length} {noun}
      </summary>
      {nav}
    </details>
  );
}

function DocSection({ id, title, file, headings, noun, children }: { id: string; title: string; file: string; headings: Heading[]; noun?: string; children: ReactNode }) {
  return (
    <section id={id} className="doc">
      <header className="doc__head">
        <h2 className="doc__title">{title}</h2>
        <span className="doc__file">
          <code>{file}</code>
        </span>
      </header>
      <Contents headings={headings} label={`In ${title}`} noun={noun} />
      {children}
    </section>
  );
}

function Reading({ links }: { links: LearnLink[] }) {
  return (
    <div className="doc-block">
      <h4 className="doc-label">Further reading</h4>
      <ul className="doc-links">
        {links.map((link) => (
          <li key={link.url}>
            <a className="doc-link" href={link.url} target="_blank" rel="noopener noreferrer">
              <span className="doc-link__source">{link.source}</span>
              <span className="doc-link__title">{link.title}</span>
              <svg className="doc-link__arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StartHereSection({ start }: { start: StartHere }) {
  return (
    <DocSection id="start-here" title="Start here" file={LEARN_FILE} headings={[]}>
      <div className="doc__body">
        <h3>{start.title}</h3>
        <p className="doc-lead">{start.summary}</p>
        <ol className="doc-layers">
          {start.layers.map((layer, i) => (
            <li key={layer.name} className="doc-layer">
              <span className="doc-layer__num">{i + 1}</span>
              <div>
                <h4 className="doc-layer__name">{layer.name}</h4>
                <p>{layer.plain}</p>
                <p className="doc-layer__rule">{layer.rule}</p>
              </div>
            </li>
          ))}
        </ol>
        {start.read_more.length > 0 && <Reading links={start.read_more} />}
      </div>
    </DocSection>
  );
}

function PartsSection({ parts, termNames }: { parts: LearnPart[]; termNames: Map<string, string> }) {
  return (
    <DocSection id="parts" title="Parts of an app" file={LEARN_FILE} headings={parts.map((p) => ({ id: `part-${p.id}`, text: p.label }))} noun="parts">
      <div className="doc__body">
        <p className="doc-lead">What each part does, how to pick one, the mistakes beginners make, and the best places to read more.</p>
        {parts.map((part, i) => (
          <article key={part.id} id={`part-${part.id}`} className="doc-part">
            <p className="doc-eyebrow">Part {String(i + 1).padStart(2, "0")}</p>
            <h3>
              <a href={`#part-${part.id}`} className="doc-anchor">
                {part.label}
              </a>
            </h3>
            <p className="doc-lead">{part.what}</p>
            <div className="doc-block">
              <h4 className="doc-label">Why you need it</h4>
              <p>{part.why}</p>
            </div>
            <div className="doc-grid">
              <div className="doc-card">
                <h4 className="doc-label">How to choose</h4>
                <ul className="doc-list doc-list--check">
                  {part.choosing.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="doc-card doc-card--warn">
                <h4 className="doc-label">Common mistakes</h4>
                <ul className="doc-list doc-list--warn">
                  {part.watch_for.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
            {part.terms.length > 0 && (
              <div className="doc-block">
                <h4 className="doc-label">Key terms</h4>
                <nav className="doc__toc" aria-label={`Terms in ${part.label}`}>
                  {part.terms.map((id) => (
                    <a key={id} href={`#term-${id}`}>
                      {termNames.get(id) ?? id}
                    </a>
                  ))}
                </nav>
              </div>
            )}
            {part.read_more.length > 0 && <Reading links={part.read_more} />}
          </article>
        ))}
      </div>
    </DocSection>
  );
}

function GlossarySection({ terms }: { terms: LearnTerm[] }) {
  return (
    <DocSection id="glossary" title="Glossary" file={LEARN_FILE} headings={terms.map((t) => ({ id: `term-${t.id}`, text: t.term }))} noun="terms">
      <div className="doc__body">
        <p className="doc-lead">The words you&apos;ll meet in docs, dashboards and AI answers.</p>
        <dl className="doc-terms">
          {terms.map((t) => (
            <div key={t.id} id={`term-${t.id}`} className="doc-term">
              <dt>
                <a href={`#term-${t.id}`} className="doc-anchor">
                  {t.term}
                </a>
              </dt>
              <dd>
                <p>{t.plain}</p>
                <p className="doc-term__matters">
                  <span className="doc-term__label">Why it matters</span> {t.matters}
                </p>
                {(t.read_more.length > 0 || t.usedIn.length > 0) && (
                  <div className="doc-term__foot">
                    {t.usedIn.length > 0 && (
                      <span>
                        Used in{" "}
                        {t.usedIn.map((p, i) => (
                          <Fragment key={p.id}>
                            {i > 0 && ", "}
                            <a href={`#part-${p.id}`}>{p.label}</a>
                          </Fragment>
                        ))}
                      </span>
                    )}
                    {t.read_more.map((link) => (
                      <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.source}: {link.title}
                      </a>
                    ))}
                  </div>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </DocSection>
  );
}

export default function DocsView({ me, learn, docs, repo }: { me: Me | null; learn: LearnContent; docs: Doc[]; repo: string }) {
  const learnItems = [
    ...(learn.startHere ? [{ id: "start-here", label: "Start here" }] : []),
    ...(learn.parts.length > 0 ? [{ id: "parts", label: "Parts of an app" }] : []),
    ...(learn.terms.length > 0 ? [{ id: "glossary", label: "Glossary" }] : []),
  ];
  const ids = [...learnItems.map((i) => i.id), ...docs.map((d) => d.id)];
  const idKey = ids.join(" ");
  const [active, setActive] = useState<string>(ids[0] ?? "start-here");
  const termNames = new Map(learn.terms.map((t) => [t.id, t.term]));

  // The sidebar follows the section in view.
  useEffect(() => {
    const sections = idKey
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
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
  }, [idKey]);

  const item = (id: string, label: string) => ({ id, label, href: `/docs#${id}`, active: active === id });
  const sidebar: ShellSections[] = [
    { title: "Learn", items: learnItems.map((i) => item(i.id, i.label)) },
    { title: "Project", items: docs.map((d) => item(d.id, d.title)) },
  ].filter((group) => group.items.length > 0);

  return (
    <Shell me={me} sections={sidebar}>
      <div className="shell-head">
        <div className="mk-stack mk-gap-1">
          <h1 className="shell-title">Documentation</h1>
          <p className="mk-muted">
            How a web app fits together, in plain words, then the project&apos;s own docs. The same files as in the repo, read from this copy of StackWise; edit them on{" "}
            <a href={repo} target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
        </div>
      </div>
      {learn.startHere && <StartHereSection start={learn.startHere} />}
      {learn.parts.length > 0 && <PartsSection parts={learn.parts} termNames={termNames} />}
      {learn.terms.length > 0 && <GlossarySection terms={learn.terms} />}
      {docs.map((doc) => (
        <DocSection key={doc.id} id={doc.id} title={doc.title} file={doc.file} headings={doc.headings}>
          {/* The repo's own Markdown, rendered on the server; nothing here comes from a person's input. */}
          <article className="doc__body" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </DocSection>
      ))}
    </Shell>
  );
}
