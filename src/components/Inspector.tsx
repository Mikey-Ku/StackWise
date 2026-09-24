"use client";

import { useMemo, useState } from "react";
import { alternativesFor, costLine, CRITERIA, criterionLabel, formatFactValue, inSentence, isOwn, isStale, optionStats, ownId, slotReasoning, weightsFor, type CheckResult, type SlotId } from "@/engine";
import { Icon } from "./icons";
import { NoteEditor } from "./NoteEditor";
import type { PlanModel } from "./usePlans";
import { Logo, StatGrid, VerdictBadge, copyText, cx } from "./ui";

function ResultCard({ result }: { result: CheckResult }) {
  return (
    <div className={cx("ws-result", `ws-result--${result.level}`)}>
      <div className="mk-row mk-gap-2 mk-wrap">
        <VerdictBadge level={result.level} short />
        <strong>{result.title}</strong>
      </div>
      <p>{result.explanation}</p>
      {result.fix && <p className="mk-muted">Fix: {result.fix}</p>}
      {result.sources && (
        <p className="mk-hint">
          Sources:{" "}
          {result.sources.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {i ? `, ${new URL(url).hostname}` : new URL(url).hostname}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}

export function Inspector({
  model,
  slot,
  today,
  onAsk,
  onToast,
  onCompare,
  onLearn,
}: {
  model: PlanModel;
  slot: SlotId | null;
  today: string;
  onAsk: (slot: SlotId) => void;
  onToast: (message: string) => void;
  onCompare: (slot: SlotId, optionIds: string[]) => void;
  onLearn: () => void;
}) {
  const { index, rec, input, catalog } = model;
  const [picked, setPicked] = useState<string[]>([]);
  const alternatives = useMemo(() => (slot ? alternativesFor(index, input, rec.selection, slot) : []), [index, input, rec.selection, slot]);

  if (!slot) {
    return (
      <div className="ws-inspector ws-inspector--empty">
        <p className="mk-muted">Click any part of the canvas to see why it was picked, every check on it, what it costs, and what else would work.</p>
      </div>
    );
  }

  const def = index.slotsById.get(slot)!;
  const learn = catalog.learn.slots[slot];
  const optionId = rec.selection[slot];
  const option = optionId ? index.optionsById.get(optionId) : undefined;
  const own = isOwn(optionId);
  const results = rec.results.filter((r) => r.slots.includes(slot));
  const weights = weightsFor(index, input.priority);
  const priority = catalog.planning.priorities.find((p) => p.id === input.priority);
  const scores = rec.score.perSlot[slot]?.scores;
  const cost = option ? costLine(index, option, slot, input) : undefined;
  // Your own code has no facts, so its stats would all read "not verified".
  const stats = option && !isOwn(option.id) ? optionStats(index, option, slot, input) : [];
  const pickedHere = picked.filter((id) => alternatives.some((a) => a.option.id === id));

  const togglePick = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current.filter((x) => alternatives.some((a) => a.option.id === x)), id].slice(-3)));

  return (
    <div className="ws-inspector">
      <div className="mk-stack mk-gap-2">
        <span className="mk-eyebrow">{def.label}</span>
        <div className="ws-inspector__title">
          {option && own ? (
            <span className="ws-own-logo" aria-hidden>
              <Icon name="terminal" size={20} />
            </span>
          ) : (
            option && <Logo logo={catalog.logos[option.id]} name={option.name} size={40} />
          )}
          <h3 className="ws-h3">{option ? option.name : `Nothing in ${def.label} yet`}</h3>
        </div>
        {option && (
          <div className="mk-row mk-gap-2 mk-wrap">
            <span className="mk-badge" title={own ? "Your own code. StackWise can't check or price it." : rec.autoPicked.includes(slot) ? "StackWise picked this from your answers and priority. It changes if they change." : "You picked this. StackWise won't change it."}>
              {own ? "Your own code" : rec.autoPicked.includes(slot) ? "Picked by StackWise" : "Picked by you"}
            </span>
            {option.coverage !== "full" && !own && <span className="mk-badge ws-badge--unknown">Not researched</span>}
            {option.website && (
              <a className="ws-small-link" href={option.website} target="_blank" rel="noreferrer">
                Website
              </a>
            )}
          </div>
        )}
        <p className="mk-muted">{option ? option.summary : def.empty_hint}</p>
        {own && <p className="ws-own-hint">Describe it in the note below: what it is and how the app reaches it. Whoever builds the app reads it.</p>}
        <div className="mk-row mk-gap-2 mk-wrap mk-sm">
          <button type="button" className="mk-btn mk-btn--primary" onClick={() => onAsk(slot)}>
            <Icon name="sparkle" size={14} /> Ask about {option && !own ? option.name : "this"}
          </button>
          {slot !== "framework" && !own && (
            <button
              type="button"
              className="mk-btn mk-btn--ghost"
              title={`Use your own code for ${inSentence(def.label)} instead of a service`}
              onClick={() => {
                model.place(ownId(slot), slot);
                onToast(`${def.label} is now your own code. Describe it in its note. StackWise won't check or price it.`);
              }}
            >
              Build it yourself
            </button>
          )}
          {option && !own && (
            <button
              type="button"
              className="mk-btn mk-btn--secondary"
              onClick={async () => {
                const text = slotReasoning(index, input, rec.selection, slot);
                onToast(text && (await copyText(text)) ? "Copied why StackWise picked it." : "Couldn't copy.");
              }}
            >
              Copy why
            </button>
          )}
        </div>
        {stats.length > 0 && <StatGrid stats={stats} />}
      </div>

      <NoteEditor key={`note-${model.plan.id}-${slot}`} model={model} slot={slot} />

      {learn && (
        <details className="ws-details ws-learn-inline">
          <summary>About {inSentence(def.label)}</summary>
          <div className="mk-stack mk-gap-2">
            <p>{learn.what}</p>
            <p className="mk-muted">{learn.why}</p>
            <button type="button" className="ws-link ws-self-start" onClick={onLearn}>
              More in Learn
            </button>
          </div>
        </details>
      )}

      <section className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Checks</span>
        {results.length === 0 ? (
          <div className="ws-result ws-result--works">
            <VerdictBadge level="works" short />
            <p>{option ? "No problems found." : "Nothing to check yet."}</p>
          </div>
        ) : (
          results.map((r) => <ResultCard key={r.key} result={r} />)
        )}
      </section>

      {option && cost && (
        <section className="mk-stack mk-gap-2">
          <span className="mk-eyebrow">Cost</span>
          <p>
            <strong>{cost.headline}</strong>
          </p>
          {cost.detail && <p className="mk-muted">{cost.detail}</p>}
          {cost.source && (
            <p className="mk-hint">
              <a href={cost.source} target="_blank" rel="noreferrer">
                Source
              </a>
              , checked {cost.retrieved}
            </p>
          )}
        </section>
      )}

      {option && scores && (
        <details className="ws-details mk-stack mk-gap-3">
          <summary>How it scored for &ldquo;{priority?.label}&rdquo;</summary>
          {CRITERIA.map((c) => (
            <div key={c} className="ws-score">
              <div className="mk-row mk-gap-2">
                <span className="mk-grow">{criterionLabel(c, slot)}</span>
                <span className="mk-num mk-faint">weight {weights[c]}</span>
              </div>
              <div className="mk-meter">
                <div className="mk-meter__fill" style={{ width: `${Math.round(scores[c] * 100)}%` }} />
              </div>
            </div>
          ))}
          {rec.score.accountsSaved > 0 && (
            <p className="mk-hint">
              Your plan also shares {rec.score.accountsSaved} account{rec.score.accountsSaved === 1 ? "" : "s"} across parts, which counts for {priority?.label.toLowerCase()}.
            </p>
          )}
        </details>
      )}

      <section className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Compare {inSentence(def.label)} options</span>
        <div className="mk-table-wrap">
          <table className="mk-table ws-compare">
            <thead>
              <tr>
                <th aria-label="Pick to compare" />
                <th>Option, with your plan</th>
                <th className="mk-table__num">Score</th>
              </tr>
            </thead>
            <tbody>
              {alternatives.map((alt) => {
                const current = alt.option.id === optionId;
                return (
                  <tr key={alt.option.id} className={cx(current && "is-current")}>
                    <td>
                      <input type="checkbox" aria-label={`Compare ${alt.option.name}`} checked={pickedHere.includes(alt.option.id)} onChange={() => togglePick(alt.option.id)} />
                    </td>
                    <td>
                      <span className="ws-optcell">
                        <Logo logo={catalog.logos[alt.option.id]} name={alt.option.name} size={22} />
                        <span className="ws-optcell__text">
                          <span>{alt.option.name}</span>
                          <span className="ws-optcell__meta">
                            <VerdictBadge level={alt.worst} short />
                            {alt.option.coverage === "full" && <span className="mk-hint">{optionStats(index, alt.option, slot, input)[0]?.short}</span>}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="mk-table__num">
                      {current ? "current" : `${alt.delta >= 0 ? "+" : ""}${alt.delta.toFixed(1)}`}
                      {!current && (
                        <button
                          type="button"
                          className="ws-link ws-compare__use"
                          onClick={() => {
                            const error = model.place(alt.option.id, slot);
                            if (error) onToast(error);
                          }}
                        >
                          Use
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mk-row mk-gap-3 mk-wrap">
          <button type="button" className="mk-btn mk-btn--secondary mk-sm" disabled={pickedHere.length < 2} onClick={() => onCompare(slot, pickedHere)}>
            {pickedHere.length < 2 ? "Tick 2 or 3 to compare side by side" : `Compare ${pickedHere.length} side by side`}
          </button>
        </div>
        <p className="mk-hint">Score is the change to your whole plan&apos;s total if you swapped just this part.</p>
      </section>

      {option && (
        <details className="ws-details mk-stack mk-gap-3">
          <summary>Facts ({Object.keys(option.facts).length})</summary>
          {Object.keys(option.facts).length === 0 ? (
            <p className="mk-muted">Not researched yet.</p>
          ) : (
            <dl className="ws-facts">
              {Object.entries(option.facts).map(([key, fact]) => {
                const factDef = catalog.facts[key];
                return (
                  <div key={key} className="ws-fact">
                    <dt>{factDef?.label ?? key}</dt>
                    <dd>
                      <strong>{formatFactValue(index, factDef, fact.value)}</strong>
                      <span className="mk-muted">{fact.note}</span>
                      <span className="mk-hint">
                        <a href={fact.source} target="_blank" rel="noreferrer">
                          Source
                        </a>
                        , checked {fact.retrieved}
                        {isStale(fact, today) && <span className="mk-badge mk-badge--warn ws-stale">may be out of date</span>}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </details>
      )}
    </div>
  );
}
