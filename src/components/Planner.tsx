"use client";

import { useState } from "react";
import { criterionLabel, describeTotal, inSentence, money, optionStats, SIZE_IDS, SIZE_PHRASE, type CloseCall, type Need, type PriorityId, type SizeId, type SlotId } from "@/engine";
import { EXAMPLES } from "./examples";
import type { PlanModel } from "./usePlans";
import { Logo, Seg, VerdictBadge, cx } from "./ui";

const ANSWERS = [
  { id: "yes" as const, label: "Yes" },
  { id: "no" as const, label: "No" },
  { id: "not_sure" as const, label: "Not sure" },
];

export interface AiStatus {
  ai: boolean;
  model: string;
}

function QuestionRow({ model, need }: { model: PlanModel; need: Need }) {
  const { plan, dispatch } = model;
  const guess = plan.guesses[need.id];
  return (
    <div className={cx("ws-q", guess && "is-guessed")}>
      <div className="ws-q__text">
        <p>{need.question}</p>
        {guess ? (
          <p className="mk-hint">
            {guess.by === "ai" ? "Claude read" : "Matched"} &ldquo;{guess.evidence}&rdquo; and guessed {guess.answer}. Click an answer to confirm.
          </p>
        ) : (
          <p className="mk-hint">{need.why}</p>
        )}
      </div>
      <Seg label={need.question} value={plan.answers[need.id]} options={ANSWERS} onChange={(answer) => dispatch({ type: "answer", needId: need.id, answer })} />
    </div>
  );
}

function PlanSettings({ model }: { model: PlanModel }) {
  const { plan, dispatch, catalog } = model;
  return (
    <div className="mk-stack mk-gap-5">
      <div className="mk-field">
        <span className="mk-label">How many people in the first month?</span>
        <Seg<SizeId>
          label="Audience size"
          value={plan.size}
          options={SIZE_IDS.map((id) => ({ id, label: catalog.planning.sizes.find((s) => s.id === id)?.label ?? id }))}
          onChange={(size) => dispatch({ type: "setSize", size })}
        />
      </div>
      <div className="mk-field">
        <span className="mk-label">What matters most right now?</span>
        <div className="ws-priorities" role="radiogroup" aria-label="Priority">
          {catalog.planning.priorities.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={plan.priority === p.id}
              className={cx("ws-priority", plan.priority === p.id && "is-on")}
              onClick={() => dispatch({ type: "setPriority", priority: p.id as PriorityId })}
            >
              <strong>{p.label}</strong>
              <span>{p.help}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="mk-field">
        <span className="mk-label">What will you build it with?</span>
        <select className="mk-select mk-sm" value={plan.builderId} onChange={(e) => dispatch({ type: "setBuilder", builderId: e.target.value })}>
          {catalog.planning.builders.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function DescribeStep({ model, ai }: { model: PlanModel; ai: AiStatus | null }) {
  const { plan, dispatch, prefill } = model;
  const ready = plan.description.trim().length >= 12;
  return (
    <div className="mk-stack mk-gap-6">
      <div className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Step 1 of 3</span>
        <h2 className="ws-h2">What are you building?</h2>
        <p className="mk-muted">Describe it the way you would to a friend. WhyStack picks out what your app needs, and you confirm every guess before anything is decided.</p>
      </div>

      <div className="mk-stack mk-gap-2">
        <span className="mk-label">Or start from an example</span>
        <div className="ws-chips">
          {EXAMPLES.map((example) => (
            <button key={example.appName} type="button" className="ws-chip" onClick={() => dispatch({ type: "loadExample", appName: example.appName, description: example.description })}>
              {example.label}
            </button>
          ))}
        </div>
      </div>

      <label className="mk-field">
        <span className="mk-label">App name</span>
        <input className="mk-input mk-sm" value={plan.appName} placeholder="Fade" onChange={(e) => dispatch({ type: "setText", field: "appName", value: e.target.value })} />
      </label>
      <label className="mk-field">
        <span className="mk-label">Description</span>
        <textarea
          className="mk-textarea"
          rows={8}
          value={plan.description}
          placeholder="A booking app for my barber shop. Customers log in, pick a time, pay a deposit, and upload a photo of the haircut they want."
          onChange={(e) => dispatch({ type: "setText", field: "description", value: e.target.value })}
        />
        <span className="mk-hint">
          {ai?.ai
            ? "Claude reads this and quotes the words behind every guess. Your description is sent to Anthropic's API."
            : "Guesses come from keywords right now. Add an Anthropic API key to have Claude read it instead."}
        </span>
      </label>
      <div className="mk-row mk-gap-3 mk-wrap">
        <button type="button" className="mk-btn mk-btn--primary mk-sm" disabled={!ready || prefill.loading} onClick={model.readDescription}>
          {prefill.loading ? "Reading..." : "Read my description"}
        </button>
        <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => dispatch({ type: "goTo", step: "confirm" })}>
          Skip to questions
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({ model }: { model: PlanModel }) {
  const { plan, dispatch, catalog, followups, prefill } = model;
  const shown = catalog.needs.filter((n) => n.id in plan.guesses || followups.includes(n.id) || plan.answers[n.id] !== undefined);
  const rest = catalog.needs.filter((n) => !shown.includes(n));
  const guessCount = Object.keys(plan.guesses).length;

  return (
    <div className="mk-stack mk-gap-6">
      <div className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Step 2 of 3</span>
        <h2 className="ws-h2">{guessCount ? "Here's what I picked up" : "A few questions"}</h2>
        <p className="mk-muted">
          {guessCount
            ? `${guessCount} guess${guessCount === 1 ? "" : "es"} from your description, plus only the questions whose answers would change your plan.`
            : "Only the questions whose answers would change your plan."}
        </p>
        {prefill.by && <p className="mk-hint">{prefill.by === "ai" ? "Guesses by Claude, each with the words it read." : "Guesses from keywords in your description."}</p>}
        {prefill.note && <p className="mk-hint ws-note-inline">{prefill.note}</p>}
      </div>

      <div className="mk-stack mk-gap-2">{shown.map((need) => <QuestionRow key={need.id} model={model} need={need} />)}</div>

      {rest.length > 0 && (
        <details className="ws-details">
          <summary>More questions ({rest.length}, optional)</summary>
          <div className="mk-stack mk-gap-2">{rest.map((need) => <QuestionRow key={need.id} model={model} need={need} />)}</div>
        </details>
      )}

      <PlanSettings model={model} />

      <div className="mk-row mk-gap-3 mk-wrap">
        <button type="button" className="mk-btn mk-btn--primary mk-sm" onClick={() => dispatch({ type: "confirmAll" })}>
          {guessCount ? "Looks right, build my plan" : "Build my plan"}
        </button>
        <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => dispatch({ type: "goTo", step: "describe" })}>
          Back
        </button>
      </div>
    </div>
  );
}

function closeCallText(model: PlanModel, call: CloseCall): string {
  const label = inSentence(model.index.slotsById.get(call.slot)?.label ?? call.slot);
  const lead = `${call.chosen.name} edges out ${call.runnerUp.name} for ${label}`;
  const base =
    call.decidedBy === "tie"
      ? `${call.chosen.name} and ${call.runnerUp.name} tie on everything WhyStack measures for ${label}, so either is a fine pick.`
      : call.decidedBy === "accounts"
        ? `${lead} because it shares an account with another part of your stack.`
        : call.decidedBy === "fewer_problems"
          ? `${lead} because it causes fewer warnings with the rest of your plan.`
          : call.decidedBy === "perks"
            ? `${lead} because it pairs well with the rest of your plan: ${call.perk?.toLowerCase()}.`
            : call.decidedBy === "checks"
              ? `${lead} because of how it fits with the rest of your plan.`
              : `${lead}: it's ${criterionLabel(call.decidedBy, call.slot)}.`;
  const flip = call.flipsUnder ? model.catalog.planning.priorities.find((p) => p.id === call.flipsUnder)?.label : undefined;
  return flip ? `${base} If "${flip}" mattered most, ${call.runnerUp.name} would win.` : base;
}

function Explanation({ model }: { model: PlanModel }) {
  const { plan } = model;
  const key = JSON.stringify([plan.answers, plan.size, plan.priority, plan.pinned, plan.appName]);
  const [state, setState] = useState<{ key: string; text?: string; by?: string; note?: string; loading: boolean }>({ key: "", loading: false });
  const current = state.key === key ? state : { key, loading: false };

  const explain = async () => {
    setState({ key, loading: true });
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appName: plan.appName, description: plan.description, answers: plan.answers, size: plan.size, priority: plan.priority, pinned: plan.pinned }),
      });
      const result = (await response.json()) as { text?: string; by?: string; note?: string; error?: string };
      setState({ key, loading: false, text: result.text ?? result.error, by: result.by, note: result.note });
    } catch {
      setState({ key, loading: false, text: "Couldn't reach the server to explain the plan." });
    }
  };

  return (
    <section className="mk-stack mk-gap-3">
      <span className="mk-eyebrow">In plain words</span>
      {current.text ? (
        <div className="ws-explain">
          {current.text.split(/\n\s*\n/).map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
          <p className="mk-hint">{current.by === "ai" ? "Written by Claude from your plan's verdicts, scores and costs." : "Standard summary from your plan."}</p>
          {current.note && <p className="mk-hint">{current.note}</p>}
        </div>
      ) : (
        <button type="button" className="mk-btn mk-btn--secondary mk-sm ws-self-start" disabled={current.loading} onClick={explain}>
          {current.loading ? "Explaining..." : "Explain my plan"}
        </button>
      )}
    </section>
  );
}

function PlanStep({ model, onSelect, onOpenChecklist }: { model: PlanModel; onSelect: (slot: SlotId) => void; onOpenChecklist: () => void }) {
  const { plan, dispatch, catalog, rec, calls, followups, notSure, cost, costSizes, index, input } = model;
  const problems = rec.results.filter((r) => r.level !== "info");
  const serious = problems.filter((r) => r.level === "blocked" || r.level === "missing");
  const sizeLabel = (id: string) => catalog.planning.sizes.find((s) => s.id === id)?.label ?? id;
  const optional = catalog.needs.filter((n) => followups.includes(n.id));

  return (
    <div className="mk-stack mk-gap-6">
      <div className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Step 3 of 3</span>
        <h2 className="ws-h2">{plan.appName.trim() || "Your plan"}</h2>
      </div>

      <div className={cx("mk-alert", serious.length ? "mk-alert--danger" : problems.length ? "mk-alert--warn" : "mk-alert--ok")}>
        <div className="mk-stack mk-gap-1">
          <strong>{problems.length === 0 ? "Every connection checks out." : `${problems.length} thing${problems.length === 1 ? "" : "s"} to look at before you build.`}</strong>
          <span className="mk-muted">Click any part of the canvas to see why it was picked and what else would work.</span>
        </div>
      </div>

      {problems.length > 0 && (
        <div className="mk-stack mk-gap-2">
          {problems.map((r) => (
            <button key={r.key} type="button" className="ws-issue" onClick={() => onSelect(r.slots[r.slots.length - 1])}>
              <VerdictBadge level={r.level} short />
              <span>{r.title}</span>
            </button>
          ))}
        </div>
      )}

      <Explanation model={model} />

      {calls.length > 0 && (
        <section className="mk-stack mk-gap-3">
          <span className="mk-eyebrow">Close calls</span>
          {calls.map((call) => (
            <div key={call.slot} className="ws-note">
              <p>{closeCallText(model, call)}</p>
              <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => model.place(call.runnerUp.id, call.slot)}>
                Use {call.runnerUp.name}
              </button>
            </div>
          ))}
        </section>
      )}

      {notSure.length > 0 && (
        <section className="mk-stack mk-gap-3">
          <span className="mk-eyebrow">If a &ldquo;not sure&rdquo; becomes yes</span>
          {notSure.map((h) => (
            <div key={h.needId} className="ws-note">
              <p>
                <strong>{index.needsById.get(h.needId)?.label}.</strong> {h.note}
              </p>
              {h.changes.length > 0 ? <ul>{h.changes.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="mk-hint">Nothing in this plan would change.</p>}
            </div>
          ))}
        </section>
      )}

      <section className="mk-stack mk-gap-2">
        <span className="mk-eyebrow">Cost</span>
        <p>
          For {SIZE_PHRASE[cost.now.size]}: <strong>{describeTotal(cost.now)}</strong>.
        </p>
        <ul className="ws-costlines">
          {cost.now.lines.map((line) => {
            const now = optionStats(index, line.option, line.slot, input)[0];
            return (
              <li key={line.slot}>
                <button type="button" className="ws-costlines__row" onClick={() => onSelect(line.slot)}>
                  <Logo logo={catalog.logos[line.option.id]} name={line.option.name} size={24} />
                  <span className="ws-costlines__name">
                    <span>{line.option.name}</span>
                    <span className="mk-hint">{index.slotsById.get(line.slot)?.label}</span>
                  </span>
                  <span className={cx("ws-costlines__value", `ws-tone--${now.tone}`)} title={now.note}>
                    {now.value}
                  </span>
                </button>
              </li>
            );
          })}
          {cost.now.fees.map((fee) => (
            <li key={fee.id}>
              <a className="ws-costlines__row" href={fee.source} target="_blank" rel="noreferrer">
                <span className="ws-costlines__name">
                  <span>{fee.label}</span>
                  <span className="mk-hint">Comes with {inSentence(index.slotsById.get(fee.slot)?.label ?? fee.slot)}, whichever you pick</span>
                </span>
                <span className="ws-costlines__value">
                  {money(fee.usd)} {fee.per === "year" ? "a year" : "once"}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <details className="ws-details ws-details--flush">
          <summary>Cost at every size</summary>
          <div className="mk-table-wrap">
            <table className="mk-table ws-cost-table">
              <thead>
                <tr>
                  <th>Monthly users</th>
                  <th className="mk-table__num">Monthly</th>
                </tr>
              </thead>
              <tbody>
                {costSizes.map((s) => (
                  <tr key={s.size} className={cx(s.size === plan.size && "is-current")}>
                    <td>{sizeLabel(s.size)}</td>
                    <td className="mk-table__num">
                      {money(s.monthlyUsd)}
                      {s.hasUsage ? " + usage" : ""}
                      {s.hasUnknown ? " + unverified" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mk-hint">
            Each part is free until its free plan runs out, then its first paid plan. Pay-per-use parts show as &ldquo;+ usage&rdquo;.
            {cost.now.yearlyUsd > 0 || cost.now.oneTimeUsd > 0 ? ` Not included above: ${[cost.now.yearlyUsd > 0 && `${money(cost.now.yearlyUsd)} a year`, cost.now.oneTimeUsd > 0 && `${money(cost.now.oneTimeUsd)} once`].filter(Boolean).join(" and ")}.` : ""}
          </p>
        </details>
      </section>

      <label className="mk-field">
        <span className="mk-label">Features, one per line</span>
        <textarea
          className="mk-textarea"
          rows={4}
          value={plan.features}
          placeholder={"Pick a time slot\nPay a deposit\nGet a reminder the day before"}
          onChange={(e) => dispatch({ type: "setText", field: "features", value: e.target.value })}
        />
        <span className="mk-hint">These go into your spec pack so the builder knows what to make.</span>
      </label>

      {optional.length > 0 && (
        <details className="ws-details" open>
          <summary>Sharpen your plan ({optional.length})</summary>
          <div className="mk-stack mk-gap-2">{optional.map((need) => <QuestionRow key={need.id} model={model} need={need} />)}</div>
        </details>
      )}

      <details className="ws-details">
        <summary>Your answers and settings</summary>
        <div className="mk-stack mk-gap-5">
          <div className="mk-stack mk-gap-2">
            {catalog.needs
              .filter((n) => !followups.includes(n.id))
              .map((need) => (
                <QuestionRow key={need.id} model={model} need={need} />
              ))}
          </div>
          <PlanSettings model={model} />
        </div>
      </details>

      <div className="mk-row mk-gap-3 mk-wrap">
        <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={onOpenChecklist}>
          Open the build checklist
        </button>
        <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => dispatch({ type: "goTo", step: "describe" })}>
          Edit description
        </button>
      </div>
    </div>
  );
}

export function Planner({
  model,
  ai,
  onSelect,
  onOpenChecklist,
}: {
  model: PlanModel;
  ai: AiStatus | null;
  onSelect: (slot: SlotId) => void;
  onOpenChecklist: () => void;
}) {
  if (model.plan.step === "describe") return <DescribeStep model={model} ai={ai} />;
  if (model.plan.step === "confirm") return <ConfirmStep model={model} />;
  return <PlanStep model={model} onSelect={onSelect} onOpenChecklist={onOpenChecklist} />;
}
