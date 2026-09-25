"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import type { Learn, LearnLink, SlotId } from "@/engine/schema";

type SlotEntry = NonNullable<Learn["slots"][SlotId]>;
export type LearnPart = SlotEntry & { id: SlotId; label: string };
export type LearnTerm = Learn["terms"][string] & { id: string; usedIn: { id: SlotId; label: string }[] };
type StartHere = NonNullable<Learn["start_here"]>;

const partHaystack = (p: LearnPart) => [p.label, p.what, p.why, ...p.choosing, ...p.watch_for, ...p.read_more.map((l) => `${l.title} ${l.source}`)].join(" ").toLowerCase();
const termHaystack = (t: LearnTerm) => [t.id, t.term, t.plain, t.matters].join(" ").toLowerCase();
const startHaystack = (s: StartHere) => [s.title, s.summary, ...s.layers.flatMap((l) => [l.name, l.plain, l.rule])].join(" ").toLowerCase();

/** Wraps each match of the search in <mark>, so people see why a section is still showing. */
function Hi({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

function ReadMore({ links }: { links: LearnLink[] }) {
  return (
    <ul className="learn-links">
      {links.map((link) => (
        <li key={link.url}>
          <a className="learn-link" href={link.url} target="_blank" rel="noopener noreferrer">
            <span className="learn-link__source">{link.source}</span>
            <span className="learn-link__title">{link.title}</span>
            <svg className="learn-link__arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Toc({ parts, active, showStart, showGlossary, onPick }: { parts: LearnPart[]; active: string; showStart: boolean; showGlossary: boolean; onPick?: () => void }) {
  const item = (id: string, label: ReactNode, index?: number) => (
    <li key={id}>
      <a href={`#${id}`} className={active === id ? "learn-toc__link is-active" : "learn-toc__link"} aria-current={active === id ? "location" : undefined} onClick={onPick}>
        {index !== undefined && <span className="learn-toc__num">{String(index + 1).padStart(2, "0")}</span>}
        <span>{label}</span>
      </a>
    </li>
  );
  return (
    <nav aria-label="On this page">
      {showStart && <ul className="learn-toc__list">{item("start-here", "Start here")}</ul>}
      {parts.length > 0 && (
        <>
          <p className="learn-toc__heading">Parts of an app</p>
          <ul className="learn-toc__list">{parts.map((p, i) => item(`part-${p.id}`, p.label, i))}</ul>
        </>
      )}
      {showGlossary && (
        <>
          <p className="learn-toc__heading">Reference</p>
          <ul className="learn-toc__list">{item("glossary", "Glossary")}</ul>
        </>
      )}
    </nav>
  );
}

export function LearnView({ startHere, parts, terms, sourceCount }: { startHere: StartHere | null; parts: LearnPart[]; terms: LearnTerm[]; sourceCount: number }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("start-here");
  const pendingHash = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileToc = useRef<HTMLDetailsElement>(null);
  const q = query.trim().toLowerCase();

  const termNames = useMemo(() => new Map(terms.map((t) => [t.id, t.term])), [terms]);
  const shownParts = useMemo(() => (q ? parts.filter((p) => partHaystack(p).includes(q)) : parts), [parts, q]);
  const shownTerms = useMemo(() => (q ? terms.filter((t) => termHaystack(t).includes(q)) : terms), [terms, q]);
  const showStart = Boolean(startHere) && (!q || startHaystack(startHere!).includes(q));
  const partIndex = useMemo(() => new Map(parts.map((p, i) => [p.id, i])), [parts]);

  // "/" jumps to the search box, like most docs sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || target?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Highlight the section being read: the last one whose top has passed just under the sticky bars.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) + 16 || 96;
      let current = "";
      for (const section of document.querySelectorAll<HTMLElement>("[data-toc]")) {
        if (section.getBoundingClientRect().top <= line) current = section.id;
        else break;
      }
      setActive(current || document.querySelector<HTMLElement>("[data-toc]")?.id || "");
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [shownParts, showStart, shownTerms.length]);

  // A term link clicked while searching clears the search first, then scrolls once the term is back.
  useEffect(() => {
    const hash = pendingHash.current;
    if (q || !hash) return;
    pendingHash.current = null;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
    history.replaceState(null, "", hash);
  }, [q]);

  const jump = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!q) return;
    e.preventDefault();
    pendingHash.current = e.currentTarget.getAttribute("href");
    setQuery("");
  };

  const closeMobileToc = () => {
    if (mobileToc.current) mobileToc.current.open = false;
  };

  const nothing = q && !showStart && shownParts.length === 0 && shownTerms.length === 0;

  return (
    <div className="learn">
      <a className="learn-skip" href="#learn-content">
        Skip to content
      </a>
      <header className="learn-top">
        <div className="learn-top__inner">
          <Link href="/" className="learn-brand" aria-label="StackWise, back to your plan">
            <BrandMark size={26} />
            <span className="learn-brand__name">StackWise</span>
            <span className="learn-brand__sep" aria-hidden="true">/</span>
            <span className="learn-brand__page">Learn</span>
          </Link>
          <span className="learn-top__actions">
          <ThemeSwitch className="mk-btn mk-btn--ghost mk-sm learn-theme" />
          <Link href="/" className="mk-btn mk-sm learn-back" aria-label="Back to your plan">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Back to your plan</span>
          </Link>
          </span>
        </div>
      </header>

      <div className="learn-shell">
        <aside className="learn-toc" aria-label="Table of contents">
          <div className="learn-toc__inner">
            <Toc parts={shownParts} active={active} showStart={showStart} showGlossary={shownTerms.length > 0} />
          </div>
        </aside>

        <main id="learn-content" className="learn-main">
          <div className="learn-hero">
            <p className="learn-eyebrow">StackWise Learn</p>
            <h1 className="learn-title">The parts of a web app, in plain words</h1>
            <p className="learn-lead">What each part does, how to pick one, the mistakes beginners make, and the best places to read more. Written for people building with AI tools.</p>
            <ul className="learn-stats" aria-label="What's on this page">
              <li>
                <strong>{parts.length}</strong> parts
              </li>
              <li>
                <strong>{terms.length}</strong> terms
              </li>
              <li>
                <strong>{sourceCount}</strong> sources
              </li>
            </ul>
            <div className="learn-search">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                ref={searchRef}
                className="mk-input learn-search__input"
                type="search"
                placeholder="Search parts and terms"
                aria-label="Search parts and terms"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd className="learn-search__kbd" aria-hidden="true">
                /
              </kbd>
            </div>
            {q && (
              <p className="learn-search__count" role="status">
                {shownParts.length} {shownParts.length === 1 ? "part" : "parts"} and {shownTerms.length} {shownTerms.length === 1 ? "term" : "terms"} match &ldquo;{query.trim()}&rdquo;.
              </p>
            )}
          </div>

          <details className="learn-toc-mobile" ref={mobileToc}>
            <summary>On this page</summary>
            <Toc parts={shownParts} active={active} showStart={showStart} showGlossary={shownTerms.length > 0} onPick={closeMobileToc} />
          </details>

          {nothing && (
            <div className="learn-empty">
              <p>Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
              <button type="button" className="mk-btn mk-sm" onClick={() => setQuery("")}>
                Clear search
              </button>
            </div>
          )}

          {startHere && showStart && (
            <section id="start-here" data-toc className="learn-section learn-start">
              <p className="learn-eyebrow">Start here</p>
              <h2 className="learn-h2">
                <Hi text={startHere.title} q={q} />
              </h2>
              <p className="learn-what">
                <Hi text={startHere.summary} q={q} />
              </p>
              <ol className="learn-layers">
                {startHere.layers.map((layer, i) => (
                  <li key={layer.name} className="learn-layer">
                    <span className="learn-layer__num">{i + 1}</span>
                    <div>
                      <h3 className="learn-layer__name">
                        <Hi text={layer.name} q={q} />
                      </h3>
                      <p>
                        <Hi text={layer.plain} q={q} />
                      </p>
                      <p className="learn-layer__rule">
                        <Hi text={layer.rule} q={q} />
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {startHere.read_more.length > 0 && (
                <div className="learn-block">
                  <h3 className="learn-h3">Further reading</h3>
                  <ReadMore links={startHere.read_more} />
                </div>
              )}
            </section>
          )}

          {shownParts.map((part) => (
            <section key={part.id} id={`part-${part.id}`} data-toc className="learn-section">
              <p className="learn-eyebrow">Part {String((partIndex.get(part.id) ?? 0) + 1).padStart(2, "0")}</p>
              <h2 className="learn-h2">
                <a href={`#part-${part.id}`} className="learn-anchor">
                  <Hi text={part.label} q={q} />
                </a>
              </h2>
              <p className="learn-what">
                <Hi text={part.what} q={q} />
              </p>

              <div className="learn-block">
                <h3 className="learn-h3">Why you need it</h3>
                <p>
                  <Hi text={part.why} q={q} />
                </p>
              </div>

              <div className="learn-grid">
                <div className="learn-card">
                  <h3 className="learn-h3">How to choose</h3>
                  <ul className="learn-list learn-list--check">
                    {part.choosing.map((line) => (
                      <li key={line}>
                        <Hi text={line} q={q} />
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="learn-card learn-card--warn">
                  <h3 className="learn-h3">Common mistakes</h3>
                  <ul className="learn-list learn-list--warn">
                    {part.watch_for.map((line) => (
                      <li key={line}>
                        <Hi text={line} q={q} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {part.terms.length > 0 && (
                <div className="learn-block">
                  <h3 className="learn-h3">Key terms</h3>
                  <ul className="learn-chips">
                    {part.terms.map((id) => (
                      <li key={id}>
                        <a className="learn-chip" href={`#term-${id}`} onClick={jump}>
                          {termNames.get(id) ?? id}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {part.read_more.length > 0 && (
                <div className="learn-block">
                  <h3 className="learn-h3">Further reading</h3>
                  <ReadMore links={part.read_more} />
                </div>
              )}
            </section>
          ))}

          {shownTerms.length > 0 && (
            <section id="glossary" data-toc className="learn-section">
              <p className="learn-eyebrow">Reference</p>
              <h2 className="learn-h2">Glossary</h2>
              <p className="learn-what">The words you&apos;ll meet in docs, dashboards and AI answers.</p>
              <dl className="learn-terms">
                {shownTerms.map((t) => (
                  <div key={t.id} id={`term-${t.id}`} className="learn-term">
                    <dt>
                      <a href={`#term-${t.id}`} className="learn-anchor">
                        <Hi text={t.term} q={q} />
                      </a>
                    </dt>
                    <dd>
                      <p>
                        <Hi text={t.plain} q={q} />
                      </p>
                      <p className="learn-term__matters">
                        <span className="learn-term__label">Why it matters</span> <Hi text={t.matters} q={q} />
                      </p>
                      {(t.read_more.length > 0 || t.usedIn.length > 0) && (
                        <div className="learn-term__foot">
                          {t.usedIn.length > 0 && (
                            <span className="learn-term__used">
                              Used in{" "}
                              {t.usedIn.map((p, i) => (
                                <Fragment key={p.id}>
                                  {i > 0 && ", "}
                                  <a href={`#part-${p.id}`} onClick={jump}>
                                    {p.label}
                                  </a>
                                </Fragment>
                              ))}
                            </span>
                          )}
                          {t.read_more.map((link) => (
                            <a key={link.url} className="learn-term__read" href={link.url} target="_blank" rel="noopener noreferrer">
                              {link.source}: {link.title}
                              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                                <path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </a>
                          ))}
                        </div>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <footer className="learn-foot">
            <p>Links go to the original publishers and open in a new tab. StackWise checks your plan against sourced facts; these pages explain the ideas behind those checks.</p>
            <Link href="/" className="mk-btn mk-sm">
              Back to your plan
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
