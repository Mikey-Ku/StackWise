"use client";

import { useState } from "react";
import { FEATURED_AGENTS } from "@/mcp/pairing";
import { AnswererMark } from "./AnswererMark";
import { ConnectCard } from "./AskPanel";
import { STATE_TEXT, live, pickDefault, providersOf, recipientsFor, type Recipient, type RecipientId } from "./answerers";
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
/** Where to get a key for each built-in AI that can be pasted in here. */
const KEY_PAGES: Record<string, string> = {
  claude: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  deepseek: "https://platform.deepseek.com/api_keys",
};

export function ConnectPanel({
  ai,
  pairing,
  savedDefault,
  onChoose,
  onKeysChanged,
  onDone,
  onToast,
}: {
  ai: AiStatus | null;
  pairing: Pairing;
  savedDefault: string | null;
  onChoose: (id: RecipientId) => void;
  /** After a key is saved or removed: the new status, names and on or off only. */
  onKeysChanged: (ai: AiStatus) => void;
  /** Shown on the first screen: moves on to picking a template. */
  onDone?: () => void;
  onToast: (message: string) => void;
}) {
  const recipients = recipientsFor(ai, pairing);
  const current = recipients.find((r) => r.id === pickDefault(recipients, savedDefault))!;
  const agents = recipients.filter((r) => r.group === "agent");
  const featured = agents.filter((r) => FEATURED_AGENTS.includes(r.id.slice("agent:".length)));
  const more = agents.filter((r) => !featured.includes(r));
  // A built-in AI without a key can't answer yet, so it can't be the default; picking it opens its key form.
  const [keyFor, setKeyFor] = useState<RecipientId | null>(null);
  const focused = recipients.find((r) => r.id === keyFor) ?? current;
  const choose = (r: Recipient) => {
    onChoose(r.id);
    setKeyFor(r.group === "api" ? r.id : null);
    // An agent can only read a plan that's shared.
    if (r.group === "agent" && !pairing.enabled) pairing.setEnabled(true);
  };

  const card = (r: Recipient) => (
    <button key={r.id} type="button" className={cx("ws-conn", r.id === focused.id && "is-on")} aria-pressed={r.id === focused.id} onClick={() => choose(r)}>
      <span className="ws-conn__logo" aria-hidden>
        <AnswererMark id={r.id} />
        <span className={cx("ws-status-dot", live(r) && "is-on", r.state === "stopped" && "is-warn")} />
      </span>
      <span className="ws-conn__text">
        <strong>{r.group === "api" ? r.label.replace(/ \(.*\)$/, "").replace(/ API$/, "") : r.label}</strong>
        <span>{r.state === "needs-key" ? "Add a key" : r.group === "api" && r.state === "ready" ? r.label.match(/\((.*)\)/)?.[1] ?? "Ready" : STATE_TEXT[r.state]}</span>
      </span>
    </button>
  );

  const providerId = focused.group === "api" ? focused.id.slice("api:".length) : null;

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
        <div className="ws-conn-grid">{featured.map(card)}</div>
        {more.length > 0 && (
          <details className="ws-details ws-conn-more" open={more.some((r) => r.id === current.id || live(r))}>
            <summary>More agents</summary>
            <div className="ws-conn-grid">{more.map(card)}</div>
          </details>
        )}
      </section>

      <section className="ws-conn-group">
        <span className="mk-eyebrow">
          <Icon name="sparkle" size={13} /> An API key
        </span>
        <div className="ws-conn-grid">{recipients.filter((r) => r.group === "api").map(card)}</div>
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

      {focused.group === "agent" && !live(focused) && <ConnectCard recipient={focused} pairing={pairing} onToast={onToast} />}
      {focused.group === "agent" && live(focused) && (
        <p className="ws-conn-ok">
          <span className="ws-status-dot is-on" aria-hidden /> {focused.label} is connected and listening. Write to it from Ask (Cmd+K).
        </p>
      )}
      {providerId && focused.keyName && (
        <KeyForm key={focused.id} recipient={focused} keyName={focused.keyName} keyPage={KEY_PAGES[providerId]} onSaved={onKeysChanged} onToast={onToast} />
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

/**
 * Pasting a built-in AI's key. It goes to StackWise's own .env.local through /api/keys and is used
 * at once; the page never gets it back, only whether the AI is on.
 */
function KeyForm({
  recipient,
  keyName,
  keyPage,
  onSaved,
  onToast,
}: {
  recipient: Recipient;
  keyName: string;
  keyPage?: string;
  onSaved: (ai: AiStatus) => void;
  onToast: (message: string) => void;
}) {
  const ready = recipient.state === "ready";
  const [editing, setEditing] = useState(!ready);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const name = recipient.label.replace(/ \(.*\)$/, "").replace(/ API$/, "");

  const save = async (next: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: keyName, value: next }) });
      const body = (await response.json()) as { error?: string; providers?: AiStatus["providers"] };
      if (!response.ok || !body.providers) throw new Error(body.error ?? "Couldn't save the key.");
      const first = body.providers.find((p) => p.on);
      onSaved({ ai: Boolean(first), model: first?.model ?? "", providers: body.providers });
      setValue("");
      setEditing(!next);
      onToast(next ? `Saved. ${name} is ready.` : `Removed the ${name} key.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Couldn't save the key.");
    } finally {
      setBusy(false);
    }
  };

  if (ready && !editing) {
    return (
      <div className="ws-connect ws-keyform">
        <p className="ws-conn-ok">
          <span className="ws-status-dot is-on" aria-hidden /> {recipient.label} is ready.
        </p>
        <div className="mk-row mk-gap-2 mk-wrap">
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => setEditing(true)}>
            Replace key
          </button>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" disabled={busy} onClick={() => void save("")}>
            Remove key
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="ws-connect ws-keyform"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) void save(value);
      }}
    >
      <strong>{ready ? `Replace your ${name} key` : `Add your ${name} key`}</strong>
      <div className="ws-keyform__row">
        <input
          className="mk-input mk-sm"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={keyName}
          aria-label={`${name} API key`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="mk-btn mk-btn--primary mk-sm" disabled={busy || !value.trim()}>
          {busy ? "Saving" : "Save"}
        </button>
        {ready && (
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
      <span className="mk-hint">
        Saved as <code>{keyName}</code> in StackWise&apos;s <code>.env.local</code> on this computer and used right away. It only goes to {name}, and StackWise never shows it again.
        {keyPage && (
          <>
            {" "}
            <a href={keyPage} target="_blank" rel="noreferrer">
              Get a key
            </a>
          </>
        )}
      </span>
    </form>
  );
}
