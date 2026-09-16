"use client";

import { checklistProgress, envFileText, planEnv, type ChecklistItem } from "@/engine";
import type { PlanModel } from "./usePlans";
import { Logo, copyText, cx } from "./ui";

function Item({ item, done, onToggle }: { item: ChecklistItem; done: boolean; onToggle: () => void }) {
  return (
    <label className={cx("ws-check-item", done && "is-done")}>
      <input type="checkbox" checked={done} onChange={onToggle} />
      <span className="mk-stack mk-gap-1 ws-check-item__body">
        <span>{item.text}</span>
        {(item.env.length > 0 || item.source) && (
          <span className="mk-hint ws-check-item__meta">
            {item.env.map((e) => (
              <code key={e} className="ws-env">
                {e}
              </code>
            ))}
            {item.source && (
              <a href={item.source} target="_blank" rel="noreferrer">
                docs
              </a>
            )}
          </span>
        )}
      </span>
    </label>
  );
}

/** Spec-driven development, tracked: the setup steps and build order from the plan, checked off as you go. */
export function ChecklistPanel({ model, today, onToast }: { model: PlanModel; today: string; onToast: (message: string) => void }) {
  const { checklist, plan, dispatch, catalog, index, rec } = model;
  const progress = checklistProgress(checklist, plan.checked);
  const env = planEnv(index, rec.selection);
  const browserCount = env.filter((v) => v.browser).length;
  const groups = [...new Map(checklist.setup.map((i) => [i.optionId, i.optionName])).entries()];

  if (plan.step !== "plan") {
    return (
      <div className="ws-inspector ws-inspector--empty">
        <p className="mk-muted">Build your plan first. The checklist fills in with every account to create, key to copy and build step, in order.</p>
      </div>
    );
  }

  return (
    <div className="ws-inspector">
      <div className="mk-stack mk-gap-2">
        <span className="mk-eyebrow">Build checklist</span>
        <p>
          <strong>
            {progress.done} of {progress.total} done
          </strong>
        </p>
        <div className="mk-meter mk-meter--ok">
          <div className="mk-meter__fill" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
        </div>
        <p className="mk-hint">Saved in this browser with the plan. Swapping a part adds its steps and keeps what you already checked.</p>
      </div>

      <section className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">1. Set up accounts and keys</span>
        {groups.map(([optionId, name]) => (
          <div key={optionId} className="mk-stack mk-gap-2">
            <p className="mk-label ws-checkgroup">
              <Logo logo={catalog.logos[optionId]} name={name} size={20} />
              {name}
            </p>
            {checklist.setup
              .filter((i) => i.optionId === optionId)
              .map((item) => (
                <Item key={item.id} item={item} done={Boolean(plan.checked[item.id])} onToggle={() => dispatch({ type: "toggleCheck", itemId: item.id })} />
              ))}
          </div>
        ))}
      </section>

      {env.length > 0 && (
        <section className="mk-stack mk-gap-2">
          <span className="mk-eyebrow">Environment variables</span>
          <p className="mk-hint">
            {env.length} name{env.length === 1 ? "" : "s"} your code reads. Each one belongs to the part it came from, and the value is yours to fill in.
          </p>
          <ul className="ws-envlist">
            {env.map((variable) => (
              <li key={variable.name} className={cx(variable.browser && "is-public")}>
                <code className="ws-env">{variable.name}</code>
                <span className="mk-hint">
                  {variable.optionName}
                  {variable.browser ? ", the browser can read it" : ""}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mk-btn mk-btn--secondary mk-sm ws-self-start"
            onClick={async () =>
              onToast(
                (await copyText(envFileText(env, { appName: plan.appName, generatedOn: today })))
                  ? "Copied. Paste into .env.local and fill in the values."
                  : "Couldn't copy.",
              )
            }
          >
            Copy as .env.local
          </button>
          <p className="mk-hint">
            Names only, with a note on where each value comes from. Never commit the values.
            {browserCount > 0 ? ` ${browserCount} of them are read by the browser, so nothing secret can go in those.` : ""}
          </p>
        </section>
      )}

      <section className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">2. Build in this order</span>
        {checklist.build.map((item) => (
          <Item key={item.id} item={item} done={Boolean(plan.checked[item.id])} onToggle={() => dispatch({ type: "toggleCheck", itemId: item.id })} />
        ))}
      </section>
    </div>
  );
}
