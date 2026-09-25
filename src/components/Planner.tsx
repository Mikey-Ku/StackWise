"use client";

import { criterionLabel, inSentence, money, optionStats, SIZE_IDS, SIZE_PHRASE, type CheckResult, type CloseCall, type CostSummary, type Need, type PriorityId, type SizeId, type SlotId } from "@/engine";
import { descriptionReader, readDefaultAnswerer } from "./answerers";
import { TEMPLATES, type Template } from "./templates";
import type { PlanModel } from "./usePlans";
import { Icon, type IconName } from "./icons";
import { Logo, Seg, VerdictBadge, VerdictDot, cx, type Verdict } from "./ui";

const ANSWERS = [
  { id: "yes" as const, label: "Yes" },
  { id: "no" as const, label: "No" },
  { id: "not_sure" as const, label: "Not sure" },
];

export interface ProviderInfo {
  id: string;
  label: string;
  on: boolean;
  model: string;
  keyName: string;
  /** What it still needs in .env.local, by name. Older servers leave it out. */
  needs?: string[];
  /** Claude, OpenAI and Gemini are always offered; other models show once they're set up. */
  featured?: boolean;
}

export interface AiStatus {
  ai: boolean;
  model: string;
  /** Every built-in AI and whether it has a key. Older servers leave it out. */
  providers?: ProviderInfo[];
  /** Where StackWise runs from, so exported projects can start its MCP server. */
  root?: string;
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
            {guess.by === "template" ? (
              <>From the {guess.evidence} template.</>
            ) : (
              <>
                You wrote &ldquo;{guess.evidence}&rdquo;, so: {guess.answer === "not_sure" ? "not sure" : guess.answer}.
              </>
            )}
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
        <span className="mk-label">People using it each month</span>
        <Seg<SizeId>
          label="People using it each month"
          value={plan.size}
          options={SIZE_IDS.map((id) => ({ id, label: catalog.planning.sizes.find((s) => s.id === id)?.label ?? id }))}
          onChange={(size) => dispatch({ type: "setSize", size })}
        />
        <span className="mk-hint">Changes which free plans fit, and the cost. Nothing else.</span>
      </div>
      <div className="mk-field">
        <span className="mk-label">What matters most?</span>
        <span className="mk-hint">Decides between services that all work.</span>
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
        <span className="mk-label">What will build it?</span>
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

const TEMPLATE_ICONS: Record<Template["icon"], IconName> = { web: "web", phone: "phone", phones: "phones", sparkle: "sparkle", card: "card", cart: "cart", tool: "tool" };

function TemplateIcon({ id, icon }: { id: string; icon: Template["icon"] }) {
  return (
    <span className={`ws-template__icon ws-template__icon--${icon} ws-template__icon--${id}`} aria-hidden>
      <Icon name={TEMPLATE_ICONS[icon]} size={20} />
    </span>
  );
}

function DescribeStep({ model, ai }: { model: PlanModel; ai: AiStatus | null }) {
  const { plan, dispatch, prefill } = model;
  const ready = plan.description.trim().length >= 12;
  const reader = descriptionReader(ai, readDefaultAnswerer());
  return (
    <div className="mk-stack mk-gap-6">
      <div className="mk-stack mk-gap-3">
        <h2 className="ws-h2">What are you building?</h2>
        <p className="mk-muted">Pick a starting point or describe your app. You confirm every answer next.</p>
      </div>

      <div className="ws-templates" role="list">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            role="listitem"
            className="ws-template"
            onClick={() => dispatch({ type: "applyTemplate", label: template.label, description: template.description, answers: template.answers, pinned: template.pinned })}
          >
            <TemplateIcon id={template.id} icon={template.icon} />
            <strong>{template.label}</strong>
            <span>{template.blurb}</span>
          </button>
        ))}
      </div>

      <div className="ws-or" aria-hidden>
        <span>or describe it yourself</span>
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
          {reader
            ? `${reader.label} reads this and quotes the words behind each guess, so your description is sent to ${reader.label}.`
            : "Guesses come from keywords. Connect an AI with a key (top right) for better guesses."}
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
  const template = Object.values(plan.guesses).find((g) => g.by === "template")?.evidence;

  return (
    <div className="mk-stack mk-gap-6">
      <div className="mk-stack mk-gap-3">
        <h2 className="ws-h2">{guessCount ? "Check these answers" : "A few questions"}</h2>
        <p className="mk-muted">
          {guessCount
            ? `${guessCount} guessed ${template ? `from the ${template} template` : "from your description"}. Only questions that change the plan are shown.`
            : "Only questions that change the plan are shown."}
        </p>
        <p className="mk-hint">Tap an answer to confirm it. &ldquo;Not sure&rdquo; counts as no.</p>
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
  const lead = `${call.chosen.name} over ${call.runnerUp.name} for ${label}`;
  const base =
    call.decidedBy === "starting_pick"
      ? `${call.chosen.name} is set as the starting pick for ${label}. ${call.runnerUp.name} ranks higher for your priority, so switch if you like.`
      : call.decidedBy === "tie"
        ? `${call.chosen.name} and ${call.runnerUp.name} are even on cost, setup and switching. StackWise doesn't compare what they're like to use, so look at both before you pick.`
        : call.decidedBy === "accounts"
          ? `${lead}: one account with another part of your plan.`
          : call.decidedBy === "fewer_problems"
            ? `${lead}: fewer problems with the rest of your plan.`
            : call.decidedBy === "perks"
              ? `${lead}: ${call.perk?.toLowerCase()}.`
              : call.decidedBy === "checks"
                ? `${lead}: it fits the rest of your plan better.`
                : `${lead}: ${criterionLabel(call.decidedBy, call.slot)}.`;
  const flip = call.flipsUnder ? model.catalog.planning.priorities.find((p) => p.id === call.flipsUnder)?.label : undefined;
  return flip ? `${base} If "${flip}" mattered most, ${call.runnerUp.name} would win.` : base;
}

/** "1 warning", "2 warnings and 1 not verified": what's left to look at, by kind. */
const PROBLEM_WORDS: Record<Exclude<CheckResult["level"], "info">, [one: string, many: string]> = {
  blocked: ["thing that doesn't work", "things that don't work"],
  missing: ["missing service", "missing services"],
  warning: ["warning", "warnings"],
  unknown: ["check not verified", "checks not verified"],
};
export function problemPhrase(results: CheckResult[]): string {
  const parts = (Object.keys(PROBLEM_WORDS) as (keyof typeof PROBLEM_WORDS)[]).flatMap((level) => {
    const n = results.filter((r) => r.level === level).length;
    return n ? [`${n} ${PROBLEM_WORDS[level][n === 1 ? 0 : 1]}`] : [];
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/** A month's cost in words: "$0 a month + pay-per-use fees + $10.46 a year". */
function costWords(cost: CostSummary): string {
  return [
    `${money(cost.monthlyUsd)} a month`,
    cost.hasUsage && "pay-per-use fees",
    cost.yearlyUsd > 0 && `${money(cost.yearlyUsd)} a year`,
    cost.oneTimeUsd > 0 && `${money(cost.oneTimeUsd)} once`,
    cost.hasUnknown && "prices not verified yet",
  ]
    .filter(Boolean)
    .join(" + ");
}

/** Everything about the plan as a whole, in the Overview panel: what to look at, close calls, cost, features and answers. */
export function Overview({ model, onSelect, onOpenChecklist, onExplain }: { model: PlanModel; onSelect: (slot: SlotId) => void; onOpenChecklist: () => void; onExplain: () => void }) {
  const { plan, dispatch, catalog, rec, calls, followups, notSure, cost, costSizes, index, input, stats } = model;
  const problems = rec.results.filter((r) => r.level !== "info");
  const serious = problems.filter((r) => r.level === "blocked" || r.level === "missing");
  const sizeLabel = (id: string) => catalog.planning.sizes.find((s) => s.id === id)?.label ?? id;
  const optional = catalog.needs.filter((n) => followups.includes(n.id));

  return (
    <div className="mk-stack mk-gap-6">
      <div className={cx("mk-alert", serious.length ? "mk-alert--danger" : problems.length ? "mk-alert--warn" : "mk-alert--ok")}>
        <div className="mk-stack mk-gap-1">
          <strong>{problems.length === 0 ? "No problems found." : `${problemPhrase(problems)} to look at before you build.`}</strong>
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

      <button type="button" className="mk-btn mk-btn--secondary mk-sm ws-self-start" onClick={onExplain}>
        <Icon name="sparkle" size={14} /> Explain my plan
      </button>

      {calls.length > 0 && (
        <section className="mk-stack mk-gap-3">
          <span className="mk-eyebrow">Could go either way</span>
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

      {stats.accounts > 0 && (
        <section className="mk-stack mk-gap-1">
          <p>
            <strong>Accounts to create ({stats.accounts}):</strong> {stats.accountNames.join(", ")}
          </p>
          <p className="mk-hint">One per company, however many parts it covers.</p>
        </section>
      )}

      <section className="mk-stack mk-gap-2">
        <span className="mk-eyebrow">Cost</span>
        <p>
          For {SIZE_PHRASE[cost.now.size]}: <strong>{costWords(cost.now)}</strong>.
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
                  <span className="mk-hint">Needed for any {inSentence(index.slotsById.get(fee.slot)?.label ?? fee.slot)}</span>
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
                      {s.hasUnknown ? " + unknown prices" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mk-hint">
            Each part is free until its free plan runs out, then its first paid plan. &ldquo;+ usage&rdquo; means pay-per-use fees on top.
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
        <span className="mk-hint">Goes into SPEC.md for whoever builds it.</span>
      </label>

      {optional.length > 0 && (
        <details className="ws-details" open>
          <summary>Questions that could change the plan ({optional.length})</summary>
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
          Open the checklist
        </button>
        <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => dispatch({ type: "goTo", step: "describe" })}>
          Edit description
        </button>
      </div>
    </div>
  );
}

/** Describing the app and confirming the guesses, shown in a sheet over the canvas until the plan is built. */
export function Planner({ model, ai }: { model: PlanModel; ai: AiStatus | null }) {
  if (model.plan.step === "describe") return <DescribeStep model={model} ai={ai} />;
  return <ConfirmStep model={model} />;
}

/** The plan in one quiet line: what it costs now and whether every check passes. Opens the Overview. */
export function SummaryPill({ model, onOpen }: { model: PlanModel; onOpen: () => void }) {
  const { stats, rec } = model;
  const level: Verdict = stats.problems === 0 ? "works" : stats.worst;
  const extra = [stats.now.yearlyUsd > 0 && `${money(stats.now.yearlyUsd)}/yr`, stats.now.oneTimeUsd > 0 && `${money(stats.now.oneTimeUsd)} once`].filter(Boolean).join(" + ");
  const jump = stats.firstIncrease;
  const problems = rec.results.filter((r) => r.level !== "info");
  const title = [
    `${money(stats.now.monthlyUsd)} a month for ${SIZE_PHRASE[stats.now.size]}${stats.now.hasUsage ? ", plus pay-per-use fees" : ""}${extra ? `, plus ${extra}` : ""}.`,
    jump ? `${money(jump.monthlyUsd)} a month at ${SIZE_PHRASE[jump.size]}.` : "No price jump as you grow.",
    stats.problems === 0 ? "No problems found." : `${problemPhrase(problems)} to look at.`,
  ].join("\n");
  return (
    <button type="button" className="ws-summary" title={title} onClick={onOpen}>
      <strong>
        {money(stats.now.monthlyUsd)}
        <small>/mo</small>
      </strong>
      <span className="ws-summary__sep" aria-hidden />
      <span className={cx("ws-summary__checks", `ws-summary__checks--${level}`)}>
        <VerdictDot level={level} />
        {stats.problems === 0 ? "No problems" : stats.problems === 1 ? problemPhrase(problems) : `${stats.problems} problems`}
      </span>
    </button>
  );
}
