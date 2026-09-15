"use client";

import { useMemo, useState } from "react";
import { alternativesFor, costLine, CRITERIA, CRITERION_LABELS, inSentence, isStale, slotReasoning, weightsFor, type CheckResult, type SlotId } from "@/engine";
import type { PlanModel } from "./usePlans";
import { VerdictBadge, copyText, cx, formatFactValue } from "./ui";

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
      <p className="mk-hint">
        {result.source === "product" ? "Product rule" : result.source === "capability" ? "Capability rule" : "Plan check"}: {result.ruleId}
      </p>
    </div>
  );
}

export function Inspector({
  model,
  slot,
  today,
  onToast,
  onCompare,
  onLearn,
}: {
  model: PlanModel;
  slot: SlotId | null;
  today: string;
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
  const results = rec.results.filter((r) => r.slots.includes(slot));
  const weights = weightsFor(index, input.priority);
  const priority = catalog.planning.priorities.find((p) => p.id === input.priority);
  const scores = rec.score.perSlot[slot]?.scores;
  const cost = option ? costLine(index, option, slot, input) : undefined;
  const pickedHere = picked.filter((id) => alternatives.some((a) => a.option.id === id));

  const togglePick = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current.filter((x) => alternatives.some((a) => a.option.id === x)), id].slice(-3)));

  return (
    <div className="ws-inspector">
      <div className="mk-stack mk-gap-2">
        <span className="mk-eyebrow">{def.label}</span>
        <h3 className="ws-h3">{option ? option.name : `Nothing in ${def.label} yet`}</h3>
        {option && (
          <div className="mk-row mk-gap-2 mk-wrap">
            <span className="mk-badge">{rec.autoPicked.includes(slot) ? "Picked for you" : "Your choice"}</span>
            <span className={cx("mk-badge", option.coverage === "full" ? "" : "ws-badge--unknown")}>{option.coverage === "full" ? "Researched, draft facts" : "Not verified yet"}</span>
            <a className="ws-small-link" href={option.website} target="_blank" rel="noreferrer">
              Website
            </a>
          </div>
        )}
        <p className="mk-muted">{option ? option.summary : def.empty_hint}</p>
        {option && (
          <button
            type="button"
            className="mk-btn mk-btn--ghost mk-sm ws-self-start"
            onClick={async () => {
              const text = slotReasoning(index, input, rec.selection, slot);
              onToast(text && (await copyText(text)) ? "Reasoning copied. Paste it into a doc or pull request." : "Couldn't copy to the clipboard.");
            }}
          >
            Copy the reasoning
          </button>
        )}
      </div>

      {learn && (
        <details className="ws-details ws-learn-inline">
          <summary>What is {inSentence(def.label)}?</summary>
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
            <p>{option ? "No rule found a problem with this part of your plan." : "No checks run on an empty slot."}</p>
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
        <section className="mk-stack mk-gap-3">
          <span className="mk-eyebrow">How it scored for &ldquo;{priority?.label}&rdquo;</span>
          {CRITERIA.map((c) => (
            <div key={c} className="ws-score">
              <div className="mk-row mk-gap-2">
                <span className="mk-grow">{CRITERION_LABELS[c]}</span>
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
        </section>
      )}

      <section className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Compare {inSentence(def.label)} options</span>
        <div className="mk-table-wrap">
          <table className="mk-table ws-compare">
            <thead>
              <tr>
                <th aria-label="Pick to compare" />
                <th>Option</th>
                <th>With your plan</th>
                <th className="mk-table__num">Score</th>
                <th />
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
                      {alt.option.name}
                      {alt.option.coverage === "partial" && <div className="mk-hint">not verified</div>}
                    </td>
                    <td>
                      <VerdictBadge level={alt.worst} short />
                    </td>
                    <td className="mk-table__num">{current ? "current" : `${alt.delta >= 0 ? "+" : ""}${alt.delta.toFixed(1)}`}</td>
                    <td>
                      {!current && (
                        <button
                          type="button"
                          className="ws-link"
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
        <section className="mk-stack mk-gap-3">
          <span className="mk-eyebrow">Facts behind it</span>
          {Object.keys(option.facts).length === 0 ? (
            <p className="mk-muted">No facts researched yet. Anyone can add them with a pull request to data/options/{option.id}.json.</p>
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
                        , {fact.retrieved}, {fact.status}
                        {isStale(fact, today) && <span className="mk-badge mk-badge--warn ws-stale">may be out of date</span>}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </section>
      )}
    </div>
  );
}
