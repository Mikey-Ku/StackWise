"use client";

import { ConnectCard } from "./AskPanel";
import { STATE_TEXT, answererLogo, live, pickDefault, providersOf, recipientsFor, type Recipient, type RecipientId } from "./answerers";
import { Icon } from "./icons";
import type { AiStatus } from "./Planner";
import type { Pairing } from "./usePairing";
import { cx } from "./ui";

/**
 * Connecting the AI comes first: it's what explains the plan, answers questions and builds the
 * app. This is the first screen for a new visitor, and the popover behind the connection pill in
 * the top bar. Picking one saves it as the default answerer; StackWise's rules still decide every
 * verdict, whatever is connected.
 */
export function ConnectPanel({
  ai,
  pairing,
  savedDefault,
  onChoose,
  onDone,
  onToast,
}: {
  ai: AiStatus | null;
  pairing: Pairing;
  savedDefault: string | null;
  onChoose: (id: RecipientId) => void;
  /** Shown on the first screen: moves on to picking a template. */
  onDone?: () => void;
  onToast: (message: string) => void;
}) {
  const recipients = recipientsFor(ai, pairing);
  const current = recipients.find((r) => r.id === pickDefault(recipients, savedDefault))!;
  const choose = (r: Recipient) => {
    onChoose(r.id);
    // An agent can only read a plan that's shared.
    if (r.group === "agent" && !pairing.enabled) pairing.setEnabled(true);
  };

  const card = (r: Recipient, recommended = false) => (
    <button key={r.id} type="button" className={cx("ws-conn", r.id === current.id && "is-on")} aria-pressed={r.id === current.id} onClick={() => choose(r)}>
      <span className="ws-conn__logo" aria-hidden>
        {answererLogo(r.id) && (
          // eslint-disable-next-line @next/next/no-img-element -- a committed brand icon
          <img src={answererLogo(r.id)!} alt="" />
        )}
        <span className={cx("ws-status-dot", live(r) && "is-on", r.state === "stopped" && "is-warn")} />
      </span>
      <span className="ws-conn__text">
        <strong>
          {r.group === "api" ? r.label.replace(/ \(.*\)$/, "") : r.label}
          {recommended && <span className="ws-conn__tag">Recommended</span>}
        </strong>
        <span>{r.state === "needs-key" && r.keyName ? `Add ${r.keyName}` : r.group === "api" && r.state === "ready" ? r.label.match(/\((.*)\)/)?.[1] ?? "Ready" : STATE_TEXT[r.state]}</span>
      </span>
    </button>
  );

  return (
    <div className="ws-connect-panel">
      <div className="mk-stack mk-gap-2">
        <h2 className="ws-h2">Connect your AI</h2>
        <p className="mk-muted">
          Your AI explains the plan, answers questions and, from your terminal, builds the app. StackWise&apos;s rules still check every connection. You can change this any time from the top bar.
        </p>
      </div>

      <section className="ws-conn-group">
        <span className="mk-eyebrow">
          <Icon name="terminal" size={13} /> A coding agent in your terminal
        </span>
        <div className="ws-conn-grid">{recipients.filter((r) => r.group === "agent").map((r) => card(r, r.id === "agent:claude-code"))}</div>
      </section>

      <section className="ws-conn-group">
        <span className="mk-eyebrow">
          <Icon name="sparkle" size={13} /> An API key
        </span>
        <div className="ws-conn-grid">{recipients.filter((r) => r.group === "api").map((r) => card(r))}</div>
      </section>

      {providersOf(ai).some((p) => p.featured === false && !p.on) && (
        <details className="ws-details ws-conn-more">
          <summary>More models</summary>
          <p className="mk-hint">StackWise also works with any of these once their variables are in .env.local (then restart pnpm dev). Your key stays on this computer.</p>
          <ul>
            {providersOf(ai)
              .filter((p) => p.featured === false && !p.on)
              .map((p) => (
                <li key={p.id}>
                  <strong>{p.label}</strong>: <code>{(p.needs ?? [p.keyName]).join(", ")}</code>
                </li>
              ))}
          </ul>
        </details>
      )}

      {current.group === "agent" && !live(current) && <ConnectCard recipient={current} pairing={pairing} onToast={onToast} />}
      {current.group === "agent" && live(current) && (
        <p className="ws-conn-ok">
          <span className="ws-status-dot is-on" aria-hidden /> {current.label} is connected and listening. Write to it from Ask (Cmd+K).
        </p>
      )}
      {current.group === "api" && current.state === "needs-key" && (
        <div className="ws-connect">
          <strong>Add your {current.label} key</strong>
          <span className="mk-muted">
            Put <code>{current.keyName}=your-key</code> in <code>.env.local</code> in StackWise&apos;s folder, then restart <code>pnpm dev</code>. The key stays on this computer and only goes to {current.label.replace(" API", "")}.
          </span>
        </div>
      )}
      {current.group === "api" && current.state === "ready" && (
        <p className="ws-conn-ok">
          <span className="ws-status-dot is-on" aria-hidden /> {current.label} is ready.
        </p>
      )}

      <div className="mk-row mk-gap-3 mk-wrap">
        {onDone && (
          <button type="button" className="mk-btn mk-btn--primary" onClick={onDone}>
            {live(current) ? "Continue" : "Continue for now"}
          </button>
        )}
      </div>
    </div>
  );
}
