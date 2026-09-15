"use client";

import { checklistProgress, type ChecklistItem } from "@/engine";
import type { PlanModel } from "./usePlans";
import { copyText, cx } from "./ui";

function Item({ item, done, onToggle }: { item: ChecklistItem; done: boolean; onToggle: () => void }) {
  return (
    <label className={cx("ws-check-item", done && "is-done")}>
      <input type="checkbox" checked={done} onChange={onToggle} />
      <span className="mk-stack mk-gap-1">
        <span>{item.text}</span>
        {(item.env.length > 0 || item.source) && (
          <span className="mk-hint">
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
export function ChecklistPanel({ model, onToast }: { model: PlanModel; onToast: (message: string) => void }) {
  const { checklist, plan, dispatch } = model;
  const progress = checklistProgress(checklist, plan.checked);
  const envNames = [...new Set(checklist.setup.flatMap((i) => i.env))];
  const groups = [...new Set(checklist.setup.map((i) => i.optionName))];

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
        {groups.map((name) => (
          <div key={name} className="mk-stack mk-gap-2">
            <p className="mk-label">{name}</p>
            {checklist.setup
              .filter((i) => i.optionName === name)
              .map((item) => (
                <Item key={item.id} item={item} done={Boolean(plan.checked[item.id])} onToggle={() => dispatch({ type: "toggleCheck", itemId: item.id })} />
              ))}
          </div>
        ))}
      </section>

      {envNames.length > 0 && (
        <section className="mk-stack mk-gap-2">
          <span className="mk-eyebrow">Environment variables</span>
          <pre className="mk-code">{envNames.map((e) => `${e}=`).join("\n")}</pre>
          <button
            type="button"
            className="mk-btn mk-btn--secondary mk-sm ws-self-start"
            onClick={async () => onToast((await copyText(envNames.map((e) => `${e}=`).join("\n"))) ? "Copied. Paste into .env.local and fill in the values." : "Couldn't copy.")}
          >
            Copy as .env.local
          </button>
          <p className="mk-hint">Names only. Never commit the values or put them in browser code.</p>
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
