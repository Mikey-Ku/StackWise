"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { BrandMark } from "@/components/BrandMark";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { Logo, Seg, cx, useMediaQuery } from "@/components/ui";
import { reviewCounts, type Logo as LogoFile, type ReviewItem } from "@/engine";
import type { ReviewFlag } from "@/engine/review-store";

type Item = ReviewItem & { flag?: ReviewFlag };
type Filter = "defaults" | "all" | "flagged";
interface Loaded {
  items: Item[];
  logos: Record<string, LogoFile>;
  defaults: string[];
}
interface Decided {
  key: string;
  status: Item["status"];
  reviewed?: string;
  flag?: ReviewFlag;
}

const FILTERS: Record<Filter, (item: Item) => boolean> = {
  defaults: (item) => item.tier === "defaults",
  all: () => true,
  flagged: (item) => Boolean(item.flag),
};

/** Still waiting on a decision: a draft nobody flagged. In the flagged view, every flag is. */
const waiting = (filter: Filter, item: Item) => (filter === "flagged" ? Boolean(item.flag) : item.status !== "verified" && !item.flag);

/** "supabase.com/docs/guides/auth", for reading at a glance; the link itself keeps the full URL. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

function withDecision(item: Item, decided: Decided): Item {
  const next: Item = { ...item, status: decided.status };
  if (decided.reviewed) next.reviewed = decided.reviewed;
  else delete next.reviewed;
  if (decided.flag) next.flag = decided.flag;
  else delete next.flag;
  return next;
}

function StatusBadge({ item }: { item: Item }) {
  if (item.flag) return <span className="mk-badge mk-badge--warn">Flagged {item.flag.flagged}</span>;
  if (item.status === "verified") return <span className="mk-badge mk-badge--ok">{item.reviewed ? `Reviewed ${item.reviewed}` : "Verified"}</span>;
  return <span className="mk-badge">Draft</span>;
}

/**
 * The fact review: one fact at a time with its source, and every fact in the view listed beside it.
 * "Matches the source" marks the fact verified in its option file; "Something's off" keeps it a
 * draft and saves the comment for whoever fixes it. J and K move, Y confirms, N flags, O opens the source.
 */
export default function ReviewView() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [filter, setFilter] = useState<Filter>("defaults");
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [comment, setComment] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const sideList = useMediaQuery("(min-width: 900px)");

  useEffect(() => {
    let live = true;
    fetch("/api/review")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!live) return;
        if (response.ok) {
          setData(body as Loaded);
          setError(null);
        } else setError((body as { error?: string }).error ?? `The review didn't load (HTTP ${response.status}).`);
      })
      .catch(() => live && setError("StackWise didn't answer. Is it still running?"));
    return () => {
      live = false;
    };
  }, [reloads]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const items = data?.items ?? [];
  const visible = items.filter(FILTERS[filter]);
  const found = visible.findIndex((i) => i.key === currentKey);
  // Until someone picks one, start at the first fact still waiting on a decision.
  const pos = found >= 0 ? found : Math.max(0, visible.findIndex((i) => waiting(filter, i)));
  const item: Item | undefined = visible[pos];
  const counts = reviewCounts(items);
  const flagged = items.filter((i) => i.flag).length;
  const left = visible.filter((i) => waiting(filter, i)).length;

  useEffect(() => {
    // Keep the current row in sight when the list scrolls on its own beside the card.
    if (!sideList || !item) return;
    listRef.current?.querySelector(`[data-key="${CSS.escape(item.key)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sideList, item]);

  const go = (key: string | undefined) => {
    if (!key) return;
    setCurrentKey(key);
    setFlagging(false);
    setComment("");
  };
  const move = (step: number) => go(visible[Math.min(visible.length - 1, Math.max(0, pos + step))]?.key);

  /** The next fact after this one still waiting on a decision, going round to the start; this one when there's none. */
  const nextWaiting = (from: number, skip: string) => {
    for (let n = 1; n <= visible.length; n++) {
      const candidate = visible[(from + n) % visible.length];
      if (candidate.key !== skip && waiting(filter, candidate)) return candidate.key;
    }
    return skip;
  };

  const decide = async (decision: "confirm" | "flag", note?: string) => {
    if (!item || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optionId: item.optionId, fact: item.fact, decision, ...(note?.trim() ? { comment: note.trim() } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setToast((body as { error?: string }).error ?? "That didn't save.");
        return;
      }
      const decided = body as Decided;
      setData((d) => d && { ...d, items: d.items.map((i) => (i.key === decided.key ? withDecision(i, decided) : i)) });
      setToast(decision === "confirm" ? `${item.optionName}: ${item.label} marked verified.` : `${item.optionName}: ${item.label} flagged. It stays a draft.`);
      go(nextWaiting(pos, item.key));
    } catch {
      setToast("StackWise didn't answer. Is it still running?");
    } finally {
      setBusy(false);
    }
  };

  const openFlag = () => {
    if (!item) return;
    setComment(item.flag?.comment ?? "");
    setFlagging(true);
  };
  const submitFlag = (e?: FormEvent) => {
    e?.preventDefault();
    void decide("flag", comment);
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    const key = e.key.toLowerCase();
    if (key === "j") move(1);
    else if (key === "k") move(-1);
    else if (key === "y") void decide("confirm");
    else if (key === "n") openFlag();
    else if (key === "o" && item) window.open(item.source, "_blank", "noopener,noreferrer");
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const pick = (key: string) => {
    go(key);
    if (!sideList) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const raw = item ? JSON.stringify(item.value) : "";
  const changedSinceFlag = item?.flag && JSON.stringify(item.flag.value) !== raw;
  const percent = counts.behindDefaults ? Math.round((counts.behindDefaultsReviewed / counts.behindDefaults) * 100) : 0;

  return (
    <div className="apps rv">
      <header className="apps-top">
        <div className="apps-top__inner">
          <Link href="/" className="apps-brand" aria-label="StackWise, back to your plan">
            <BrandMark size={26} />
            <span className="apps-brand__name">StackWise</span>
            <span className="apps-brand__sep" aria-hidden="true">
              /
            </span>
            <span className="apps-brand__page">Review facts</span>
          </Link>
          <span className="apps-top__actions">
            <ThemeSwitch className="mk-btn mk-btn--ghost mk-sm apps-theme" />
            <Link href="/" className="mk-btn mk-sm apps-back">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Back to your plan</span>
            </Link>
          </span>
        </div>
      </header>

      <main className="apps-main rv-main">
        <div className="rv-head">
          <div className="mk-stack mk-gap-1">
            <h1 className="apps-title">Review facts</h1>
            <p className="mk-muted rv-intro">
              Open each fact&apos;s source and check it says the same thing. &ldquo;Matches the source&rdquo; marks the fact verified in <code className="mk-mono">data/options</code> with
              today&apos;s date. &ldquo;Something&apos;s off&rdquo; keeps it a draft and saves your note in <code className="mk-mono">.stackwise/review-flags.json</code>.
            </p>
          </div>
          {data && (
            <div className="rv-progress" aria-live="polite">
              <p>
                <strong>
                  {counts.behindDefaultsReviewed} of {counts.behindDefaults}
                </strong>{" "}
                facts behind the default picks reviewed
              </p>
              <div className="mk-meter mk-meter--ok" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Facts behind the default picks reviewed">
                <div className="mk-meter__fill" style={{ width: `${percent}%` }} />
              </div>
              <p className="mk-hint">
                {counts.reviewed} of {counts.total} in all · {flagged} flagged
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mk-alert mk-alert--danger rv-error">
            <span>{error}</span>
            <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => setReloads((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}
        {!data && !error && <p className="mk-muted">Loading facts...</p>}

        {data && (
          <>
            <div className="rv-filters">
              <Seg<Filter>
                label="Which facts"
                value={filter}
                onChange={(next) => {
                  setFilter(next);
                  setCurrentKey(null);
                  setFlagging(false);
                }}
                options={[
                  { id: "defaults", label: `Behind defaults (${counts.behindDefaults})` },
                  { id: "all", label: `All (${counts.total})` },
                  { id: "flagged", label: `Flagged (${flagged})` },
                ]}
              />
              <p className="mk-hint rv-keys">
                <kbd className="mk-kbd">J</kbd> <kbd className="mk-kbd">K</kbd> move, <kbd className="mk-kbd">Y</kbd> matches, <kbd className="mk-kbd">N</kbd> something&apos;s off,{" "}
                <kbd className="mk-kbd">O</kbd> opens the source
              </p>
            </div>
            {filter === "defaults" && <p className="mk-hint rv-defaults">The defaults: {data.defaults.join(", ")}. Their facts come first, the ones most plans rest on at the top.</p>}

            {!item ? (
              <p className="mk-muted rv-empty">{filter === "flagged" ? "Nothing flagged. Facts you mark “Something’s off” show up here." : "No facts here."}</p>
            ) : (
              <div className="rv-layout">
                <article ref={cardRef} className="rv-card" aria-labelledby="rv-fact-label">
                  {left === 0 && <div className="mk-alert mk-alert--ok">{filter === "flagged" ? "Every flag has an answer." : "Every fact in this view has a decision."}</div>}
                  <header className="rv-card__head">
                    <Logo logo={data.logos[item.optionId]} name={item.optionName} size={36} />
                    <span className="rv-card__option">
                      <strong>{item.optionName}</strong>
                      <span className="mk-hint">{item.parts.join(", ")}</span>
                    </span>
                    <span className="rv-card__pos mk-hint">
                      {pos + 1} of {visible.length}
                    </span>
                  </header>

                  <div className="mk-stack mk-gap-1">
                    <div className="rv-card__title">
                      <h2 id="rv-fact-label" className="rv-label">
                        {item.label}
                      </h2>
                      <StatusBadge item={item} />
                    </div>
                    {item.help && <p className="mk-hint">{item.help}</p>}
                  </div>

                  <div className="rv-value">
                    <strong>{item.display}</strong>
                    {raw !== JSON.stringify(item.display) && (
                      <span className="mk-hint">
                        stored as <code className="mk-mono">{raw}</code>
                      </span>
                    )}
                  </div>

                  <p className="rv-note">{item.note}</p>

                  <dl className="rv-meta">
                    <div>
                      <dt>Source</dt>
                      <dd>
                        <a href={item.source} target="_blank" rel="noopener noreferrer" className="rv-source">
                          {shortUrl(item.source)}
                          <span aria-hidden="true"> ↗</span>
                          <span className="mk-sr"> (opens in a new tab)</span>
                        </a>
                      </dd>
                    </div>
                    <div>
                      <dt>Retrieved</dt>
                      <dd>{item.retrieved}</dd>
                    </div>
                  </dl>

                  <p className="rv-why">{item.why}</p>

                  {item.flag && (
                    <div className="mk-alert mk-alert--warn rv-flag">
                      <span>
                        <strong>Flagged {item.flag.flagged}:</strong> {item.flag.comment || "no comment"}
                      </span>
                      {changedSinceFlag && <span className="mk-hint">The value changed since. It was {JSON.stringify(item.flag.value)}.</span>}
                    </div>
                  )}

                  {flagging ? (
                    <form className="rv-flagform" onSubmit={submitFlag}>
                      <label className="mk-field">
                        <span className="mk-label">What&apos;s off?</span>
                        <textarea
                          className="mk-textarea"
                          rows={3}
                          maxLength={2000}
                          autoFocus
                          value={comment}
                          placeholder="The pricing page now says the free plan has 5 GB, not 100 GB."
                          onChange={(e) => setComment(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setFlagging(false);
                            else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitFlag();
                          }}
                        />
                        <span className="mk-hint">It stays a draft. The note goes to .stackwise/review-flags.json, not into data/.</span>
                      </label>
                      <div className="rv-actions">
                        <button type="submit" className="mk-btn mk-btn--primary" disabled={busy}>
                          Flag it
                        </button>
                        <button type="button" className="mk-btn mk-btn--ghost" onClick={() => setFlagging(false)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="rv-actions">
                      <button type="button" className="mk-btn mk-btn--primary" disabled={busy} onClick={() => void decide("confirm")}>
                        Matches the source <kbd className="mk-kbd rv-kbd">Y</kbd>
                      </button>
                      <button type="button" className="mk-btn mk-btn--secondary" disabled={busy} onClick={openFlag}>
                        Something&apos;s off <kbd className="mk-kbd rv-kbd">N</kbd>
                      </button>
                    </div>
                  )}

                  <nav className="rv-nav" aria-label="Move between facts">
                    <button type="button" className="mk-btn mk-btn--ghost mk-sm" disabled={pos === 0} onClick={() => move(-1)}>
                      Previous <kbd className="mk-kbd rv-kbd">K</kbd>
                    </button>
                    <span className="mk-hint">{left === 0 ? "None left" : `${left} left in this view`}</span>
                    <button type="button" className="mk-btn mk-btn--ghost mk-sm" disabled={pos >= visible.length - 1} onClick={() => move(1)}>
                      Next <kbd className="mk-kbd rv-kbd">J</kbd>
                    </button>
                  </nav>
                </article>

                <ol ref={listRef} className="rv-list" aria-label="Facts in this view">
                  {visible.map((i) => (
                    <li key={i.key}>
                      <button type="button" data-key={i.key} className={cx("rv-row", i.key === item.key && "is-current")} aria-current={i.key === item.key ? "true" : undefined} onClick={() => pick(i.key)}>
                        <span className={cx("rv-row__mark", i.flag ? "is-flagged" : i.status === "verified" && "is-verified")} aria-label={i.flag ? "Flagged" : i.status === "verified" ? "Verified" : "Draft"} role="img" />
                        <Logo logo={data.logos[i.optionId]} name={i.optionName} size={20} />
                        <span className="rv-row__text">
                          <span className="rv-row__name">
                            {i.optionName}: {i.label}
                          </span>
                          <span className="rv-row__value">{i.display}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </main>

      {toast && (
        <div className="ws-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
