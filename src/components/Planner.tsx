"use client";

import { describeTotal, CRITERION_LABELS, SIZE_IDS, type CloseCall, type Need, type PriorityId, type SizeId } from "@/engine";
import type { PlanModel } from "./usePlan";
import { Seg, VerdictBadge, cx } from "./ui";

const ANSWERS = [
  { id: "yes" as const, label: "Yes" },
  { id: "no" as const, label: "No" },
  { id: "not_sure" as const, label: "Not sure" },
];

function QuestionRow({ plan, need }: { plan: PlanModel; need: Need }) {
  const { state, dispatch } = plan;
  const guessed = state.guesses[need.id];
  return (
    <div className={cx("ws-q", guessed && "is-guessed")}>
      <div className="ws-q__text">
        <p>{need.question}</p>
        {guessed ? (
          <p className="mk-hint">
            Guessed from &ldquo;{guessed}&rdquo; in your description. Click an answer to confirm.
          </p>
        ) : (
          <p className="mk-hint">{need.why}</p>
        )}
      </div>
      <Seg label={need.question} value={state.answers[need.id]} options={ANSWERS} onChange={(answer) => dispatch({ type: "answer", needId: need.id, answer })} />
    </div>
  );
}

function PlanSettings({ plan }: { plan: PlanModel }) {
  const { state, dispatch, catalog } = plan;
  return (
    <div className="mk-stack mk-gap-5">
      <div className="mk-field">
        <span className="mk-label">How many people in the first month?</span>
        <Seg<SizeId>
          label="Audience size"
          value={state.size}
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
              aria-checked={state.priority === p.id}
              className={cx("ws-priority", state.priority === p.id && "is-on")}
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
        <select className="mk-select mk-sm" value={state.builderId} onChange={(e) => dispatch({ type: "setBuilder", builderId: e.target.value })}>
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

function DescribeStep({ plan }: { plan: PlanModel }) {
  const { state, dispatch } = plan;
  const ready = state.description.trim().length >= 12;
  return (
    <div className="mk-stack mk-gap-6">
      <div className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Step 1 of 3</span>
        <h2 className="ws-h2">What are you building?</h2>
        <p className="mk-muted">
          Describe it the way you would to a friend. WhyStack picks out what your app needs, and you confirm every guess before anything is decided.
        </p>
      </div>
      <label className="mk-field">
        <span className="mk-label">App name</span>
        <input className="mk-input mk-sm" value={state.appName} placeholder="Fade" onChange={(e) => dispatch({ type: "setText", field: "appName", value: e.target.value })} />
      </label>
      <label className="mk-field">
        <span className="mk-label">Description</span>
        <textarea
          className="mk-textarea"
          rows={8}
          value={state.description}
          placeholder="A booking app for my barber shop. Customers log in, pick a time, pay a deposit, and upload a photo of the haircut they want. They get a reminder the day before."
          onChange={(e) => dispatch({ type: "setText", field: "description", value: e.target.value })}
        />
      </label>
      <div className="mk-row mk-gap-3 mk-wrap">
        <button type="button" className="mk-btn mk-btn--primary mk-sm" disabled={!ready} onClick={plan.readDescription}>
          Read my description
        </button>
        <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => dispatch({ type: "goTo", step: "confirm" })}>
          Skip to questions
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({ plan }: { plan: PlanModel }) {
  const { state, dispatch, catalog, followups } = plan;
  const shown = catalog.needs.filter((n) => n.id in state.guesses || followups.includes(n.id) || state.answers[n.id] !== undefined);
  const rest = catalog.needs.filter((n) => !shown.includes(n));
  const guessCount = Object.keys(state.guesses).length;

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
        <p className="mk-hint">Guesses come from keywords for now. An AI version comes next, and it will be measured against these.</p>
      </div>

      <div className="mk-stack mk-gap-2">{shown.map((need) => <QuestionRow key={need.id} plan={plan} need={need} />)}</div>

      {rest.length > 0 && (
        <details className="ws-details">
          <summary>More questions ({rest.length}, optional)</summary>
          <div className="mk-stack mk-gap-2">{rest.map((need) => <QuestionRow key={need.id} plan={plan} need={need} />)}</div>
        </details>
      )}

      <PlanSettings plan={plan} />

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

function closeCallText(plan: PlanModel, call: CloseCall): string {
  const label = plan.index.slotsById.get(call.slot)?.label.toLowerCase();
  const base =
    call.decidedBy === "tie"
      ? `${call.chosen.name} and ${call.runnerUp.name} tie on everything WhyStack measures for ${label}, so either is a fine pick.`
      : call.decidedBy === "accounts"
        ? `${call.chosen.name} edges out ${call.runnerUp.name} for ${label} because it shares an account with another part of your stack.`
        : call.decidedBy === "fewer_problems"
          ? `${call.chosen.name} edges out ${call.runnerUp.name} for ${label} because it causes fewer warnings with the rest of your plan.`
          : call.decidedBy === "perks"
            ? `${call.chosen.name} edges out ${call.runnerUp.name} for ${label} because it pairs well with the rest of your plan: ${call.perk?.toLowerCase()}.`
            : call.decidedBy === "checks"
              ? `${call.chosen.name} edges out ${call.runnerUp.name} for ${label} because of how it fits with the rest of your plan.`
              : `${call.chosen.name} edges out ${call.runnerUp.name} for ${label}: it's ${CRITERION_LABELS[call.decidedBy]}.`;
  const flip = call.flipsUnder ? plan.catalog.planning.priorities.find((p) => p.id === call.flipsUnder)?.label : undefined;
  return flip ? `${base} If "${flip}" mattered most, ${call.runnerUp.name} would win.` : base;
}

function PlanStep({ plan }: { plan: PlanModel }) {
  const { state, dispatch, catalog, rec, calls, followups, notSure, cost, index } = plan;
  const problems = rec.results.filter((r) => r.level !== "info");
  const serious = problems.filter((r) => r.level === "blocked" || r.level === "missing");
  const sizeLabel = (id: string) => catalog.planning.sizes.find((s) => s.id === id)?.label.toLowerCase();
  const optional = catalog.needs.filter((n) => followups.includes(n.id));

  return (
    <div className="mk-stack mk-gap-6">
      <div className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Step 3 of 3</span>
        <h2 className="ws-h2">{state.appName.trim() || "Your plan"}</h2>
      </div>

      <div className={cx("mk-alert", serious.length ? "mk-alert--danger" : problems.length ? "mk-alert--warn" : "mk-alert--ok")}>
        <div className="mk-stack mk-gap-1">
          <strong>
            {problems.length === 0
              ? "Every connection checks out."
              : `${problems.length} thing${problems.length === 1 ? "" : "s"} to look at before you build.`}
          </strong>
          <span className="mk-muted">Click any part of the canvas to see why it was picked and what else would work.</span>
        </div>
      </div>

      {problems.length > 0 && (
        <div className="mk-stack mk-gap-2">
          {problems.map((r) => (
            <button key={r.key} type="button" className="ws-issue" onClick={() => dispatch({ type: "select", slot: r.slots[r.slots.length - 1] })}>
              <VerdictBadge level={r.level} short />
              <span>{r.title}</span>
            </button>
          ))}
        </div>
      )}

      {calls.length > 0 && (
        <section className="mk-stack mk-gap-3">
          <span className="mk-eyebrow">Close calls</span>
          {calls.map((call) => (
            <div key={call.slot} className="ws-note">
              <p>{closeCallText(plan, call)}</p>
              <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => plan.place(call.runnerUp.id, call.slot)}>
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
              {h.changes.length > 0 ? (
                <ul>{h.changes.map((c) => <li key={c}>{c}</li>)}</ul>
              ) : (
                <p className="mk-hint">Nothing in this plan would change.</p>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="mk-stack mk-gap-2">
        <span className="mk-eyebrow">Cost</span>
        <p>
          At {sizeLabel(cost.now.size)} people: <strong>{describeTotal(cost.now)}</strong>.
        </p>
        {cost.next && (
          <p className="mk-muted">
            At {sizeLabel(cost.next.size)} people: {describeTotal(cost.next)}.
          </p>
        )}
      </section>

      <label className="mk-field">
        <span className="mk-label">Features, one per line</span>
        <textarea
          className="mk-textarea"
          rows={4}
          value={state.features}
          placeholder={"Pick a time slot\nPay a deposit\nGet a reminder the day before"}
          onChange={(e) => dispatch({ type: "setText", field: "features", value: e.target.value })}
        />
        <span className="mk-hint">These go into your spec pack so the builder knows what to make.</span>
      </label>

      {optional.length > 0 && (
        <details className="ws-details" open>
          <summary>Sharpen your plan ({optional.length})</summary>
          <div className="mk-stack mk-gap-2">{optional.map((need) => <QuestionRow key={need.id} plan={plan} need={need} />)}</div>
        </details>
      )}

      <details className="ws-details">
        <summary>Your answers and settings</summary>
        <div className="mk-stack mk-gap-5">
          <div className="mk-stack mk-gap-2">
            {catalog.needs
              .filter((n) => !followups.includes(n.id))
              .map((need) => (
                <QuestionRow key={need.id} plan={plan} need={need} />
              ))}
          </div>
          <PlanSettings plan={plan} />
        </div>
      </details>

      <button type="button" className="mk-btn mk-btn--ghost mk-sm ws-start-over" onClick={() => dispatch({ type: "goTo", step: "describe" })}>
        Edit description
      </button>
    </div>
  );
}

export function Planner({ plan }: { plan: PlanModel }) {
  if (plan.state.step === "describe") return <DescribeStep plan={plan} />;
  if (plan.state.step === "confirm") return <ConfirmStep plan={plan} />;
  return <PlanStep plan={plan} />;
}
