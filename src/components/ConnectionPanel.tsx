"use client";

import { useMemo } from "react";
import { connectionsOf, envFileText, inSentence, planEnv, possessive, worstLevel, type EnvVar, type SlotId } from "@/engine";
import type { PlanModel } from "./usePlans";
import { Logo, VerdictBadge, copyText, cx } from "./ui";

/**
 * One connection on the canvas: the app reaching one service. It shows what travels along it,
 * which is a set of environment variable names, where each value comes from, and which of them
 * the browser can read. WhyStack never holds a value, so this is names and instructions only.
 */

function EnvRow({ variable }: { variable: EnvVar }) {
  return (
    <div className={cx("ws-envrow", variable.browser && "is-public")}>
      <div className="mk-row mk-gap-2 mk-wrap">
        <code className="ws-env">{variable.name}</code>
        <span className={cx("mk-badge", variable.browser ? "mk-badge--warn" : "")}>{variable.browser ? "the browser can read it" : "secret, server only"}</span>
      </div>
      <p className="mk-muted">{variable.step}</p>
      {variable.source && (
        <p className="mk-hint">
          <a href={variable.source} target="_blank" rel="noreferrer">
            Where to find it
          </a>
        </p>
      )}
    </div>
  );
}

export function ConnectionPanel({
  model,
  slot,
  today,
  onShowPart,
  onOpenChecklist,
  onToast,
}: {
  model: PlanModel;
  slot: SlotId;
  today: string;
  onShowPart: () => void;
  onOpenChecklist: () => void;
  onToast: (message: string) => void;
}) {
  const { index, rec, plan, catalog } = model;
  const connection = useMemo(() => connectionsOf(index, rec.selection).find((c) => c.slot === slot), [index, rec.selection, slot]);
  const all = useMemo(() => planEnv(index, rec.selection), [index, rec.selection]);
  const def = index.slotsById.get(slot)!;

  if (!connection) {
    return (
      <div className="ws-inspector ws-inspector--empty">
        <p className="mk-muted">There is nothing in {inSentence(def.label)} yet, so nothing runs between it and your app.</p>
        <button type="button" className="mk-btn mk-btn--secondary mk-sm ws-self-start" onClick={onShowPart}>
          Open {inSentence(def.label)}
        </button>
      </div>
    );
  }

  const framework = rec.selection.framework ? index.optionsById.get(rec.selection.framework) : undefined;
  const carried = connection.everything ? all : connection.env;
  const results = rec.results.filter((r) => r.slots.includes(slot) && (r.slots.length === 1 || r.slots.includes("framework")));
  const level = results.length ? worstLevel(results) : "works";

  return (
    <div className="ws-inspector">
      <div className="mk-stack mk-gap-2">
        <span className="mk-eyebrow">Connection</span>
        <div className="ws-wire">
          <span className="ws-wire__end">
            {framework && <Logo logo={catalog.logos[framework.id]} name={framework.name} size={26} />}
            <strong>{plan.appName.trim() || "Your app"}</strong>
          </span>
          <span className="ws-wire__line" aria-hidden />
          <span className="ws-wire__end">
            <Logo logo={catalog.logos[connection.optionId]} name={connection.optionName} size={26} />
            <strong>{connection.optionName}</strong>
          </span>
        </div>
        <div className="mk-row mk-gap-2 mk-wrap">
          <VerdictBadge level={level} short />
          <span className="mk-badge">{def.label}</span>
        </div>
        <p className="ws-connection-what">{connection.what}</p>
      </div>

      <section className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">
          What travels along it{carried.length > 0 ? ` (${carried.length})` : ""}
        </span>
        {carried.length === 0 ? (
          <p className="mk-muted">
            {connection.stepsKnown
              ? `No environment variable is written down for ${connection.optionName}. Read its setup steps before you build: it may still need one.`
              : `Nobody has researched ${possessive(connection.optionName)} setup yet, so WhyStack can't say what it needs. Follow its own quickstart.`}
          </p>
        ) : (
          <>
            {connection.everything && <p className="mk-hint">Every variable in the plan, because your host has to have them all before the deployed app can reach anything.</p>}
            {carried.map((variable) => (
              <EnvRow key={variable.name} variable={variable} />
            ))}
            <div className="mk-row mk-gap-2 mk-wrap">
              <button
                type="button"
                className="mk-btn mk-btn--secondary mk-sm"
                onClick={async () => {
                  const text = envFileText(carried, { appName: plan.appName, generatedOn: today });
                  onToast((await copyText(text)) ? "Copied. Paste into .env.local and fill in the values." : "Couldn't copy to the clipboard.");
                }}
              >
                Copy these for .env.local
              </button>
              <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={onOpenChecklist}>
                Setup steps
              </button>
            </div>
            <p className="mk-hint">Names only. Fill in the values yourself, keep them out of git, and never put a secret in a variable the browser can read.</p>
          </>
        )}
      </section>

      <section className="mk-stack mk-gap-3">
        <span className="mk-eyebrow">Checks on this connection</span>
        {results.length === 0 ? (
          <div className="ws-result ws-result--works">
            <VerdictBadge level="works" short />
            <p>No rule found a problem with your app using {connection.optionName}.</p>
          </div>
        ) : (
          results.map((r) => (
            <div key={r.key} className={cx("ws-result", `ws-result--${r.level}`)}>
              <div className="mk-row mk-gap-2 mk-wrap">
                <VerdictBadge level={r.level} short />
                <strong>{r.title}</strong>
              </div>
              <p>{r.explanation}</p>
              {r.fix && <p className="mk-muted">Fix: {r.fix}</p>}
            </div>
          ))
        )}
        <button type="button" className="mk-btn mk-btn--secondary mk-sm ws-self-start" onClick={onShowPart}>
          Everything about {connection.optionName}
        </button>
      </section>
    </div>
  );
}
