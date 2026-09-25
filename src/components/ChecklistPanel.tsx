"use client";

import { checklistProgress, envFileText, planEnv, setupGroups, type ChecklistItem, type SetupGroup } from "@/engine";
import type { PlanModel } from "./usePlans";
import { Logo, copyText, cx } from "./ui";

/** A step and the variable names it gives you. Docs live once, on the service's heading. */
function Item({ item, done, onToggle }: { item: ChecklistItem; done: boolean; onToggle: () => void }) {
  return (
    <label className={cx("ws-check-item", done && "is-done")}>
      <input type="checkbox" checked={done} onChange={onToggle} />
      <span className="mk-stack mk-gap-1 ws-check-item__body">
        <span>{item.text}</span>
        {item.env.length > 0 && (
          <span className="mk-hint ws-check-item__meta">
            {item.env.map((e) => (
              <code key={e} className="ws-env">
                {e}
              </code>
            ))}
          </span>
        )}
      </span>
    </label>
  );
}

/** A host name and path, short enough to read in a list. */
const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function Group({ model, group }: { model: PlanModel; group: SetupGroup }) {
  const { plan, dispatch, catalog, index } = model;
  const parts = group.slots.map((slot) => index.slotsById.get(slot)?.label ?? slot).join(", ");
  return (
    <div className="mk-stack mk-gap-2">
      <div className="ws-checkgroup">
        <Logo logo={catalog.logos[group.optionId]} name={group.optionName} size={20} />
        <span className="ws-checkgroup__name">
          <strong>{group.optionName}</strong>
          <span className="mk-hint">{parts}</span>
        </span>
        {group.docs && (
          <a className="ws-checkgroup__docs" href={group.docs} target="_blank" rel="noreferrer">
            Docs
          </a>
        )}
      </div>
      {group.shared && (
        <p className="mk-hint">
          Uses the {group.shared.withName} setup above for {group.shared.count === 1 ? "one step" : `${group.shared.count} steps`}.
        </p>
      )}
      {group.items.map((item) => (
        <Item key={item.id} item={item} done={Boolean(plan.checked[item.id])} onToggle={() => dispatch({ type: "toggleCheck", itemId: item.id })} />
      ))}
      {group.moreDocs.length > 0 && (
        <details className="ws-details ws-moredocs">
          <summary>More docs ({group.moreDocs.length})</summary>
          <ul>
            {group.moreDocs.map((doc) => (
              <li key={doc.url}>
                <span className="mk-hint">Step {doc.step}: </span>
                <a href={doc.url} target="_blank" rel="noreferrer">
                  {shortUrl(doc.url)}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The setup steps and build order from the plan, checked off as you go. `onOpenProject` opens the Project panel, when there is one. */
export function ChecklistPanel({ model, today, onToast, onOpenProject }: { model: PlanModel; today: string; onToast: (message: string) => void; onOpenProject?: () => void }) {
  const { checklist, plan, dispatch, index, rec } = model;
  const progress = checklistProgress(checklist, plan.checked, index);
  const env = planEnv(index, rec.selection);
  const browserCount = env.filter((v) => v.browser).length;
  // Names from the person's own parts that no listed service already asks for.
  const own = Object.values(plan.custom).flatMap((part) => part.env.filter((name) => !env.some((v) => v.name === name)).map((name) => ({ name, partName: part.name })));
  const count = env.length + own.length;
  const groups = setupGroups(index, checklist);

  if (plan.step !== "plan") {
    return (
      <div className="ws-inspector ws-inspector--empty">
        <p className="mk-muted">Build your plan first. The checklist then lists every account to create, key to copy and build step, in order.</p>
      </div>
    );
  }

  return (
    <div className="ws-inspector">
      <div className="mk-stack mk-gap-2">
        <p>
          <strong>
            {progress.done} of {progress.total} done
          </strong>
        </p>
        <div className="mk-meter mk-meter--ok">
          <div className="mk-meter__fill" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
        </div>
      </div>

      <section className="mk-stack mk-gap-4">
        <span className="mk-eyebrow">1. Set up accounts and keys</span>
        {groups.map((group) => (
          <Group key={group.optionId} model={model} group={group} />
        ))}
      </section>

      {count > 0 && (
        <section className="mk-stack mk-gap-2">
          <span className="mk-eyebrow">Environment variables</span>
          <p className="mk-hint">
            {count} name{count === 1 ? "" : "s"} your code reads.
          </p>
          <ul className="ws-envlist">
            {env.map((variable) => (
              <li key={variable.name} className={cx(variable.browser && "is-public")}>
                <code className="ws-env">{variable.name}</code>
                <span className="mk-hint">
                  {variable.optionName}
                  {variable.browser ? ", public" : ""}
                </span>
              </li>
            ))}
            {own.map((variable) => (
              <li key={`own-${variable.name}`}>
                <code className="ws-env">{variable.name}</code>
                <span className="mk-hint">{variable.partName}, added by you</span>
              </li>
            ))}
          </ul>
          <div className="mk-row mk-gap-2 mk-wrap">
            {onOpenProject && (
              <button type="button" className="mk-btn mk-btn--primary mk-sm" onClick={onOpenProject}>
                {plan.folder ? "Fill in the values" : "Link your project to fill them in"}
              </button>
            )}
            <button
              type="button"
              className="mk-btn mk-btn--secondary mk-sm"
              onClick={async () =>
                onToast(
                  (await copyText(envFileText(env, { appName: plan.appName, generatedOn: today, custom: plan.custom })))
                    ? "Copied. Paste into .env.local and fill in the values."
                    : "Couldn't copy.",
                )
              }
            >
              Copy as .env.local
            </button>
          </div>
          <p className="mk-hint">
            Values go into your project&apos;s .env.local and never come back to this page.
            {browserCount > 0 ? ` ${browserCount} ${browserCount === 1 ? "is" : "are"} public: anyone who opens the app can read ${browserCount === 1 ? "it" : "them"}, so no secrets there.` : ""}
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
