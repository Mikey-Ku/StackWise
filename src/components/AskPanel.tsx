"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { answerFromFacts, evaluatePlan, inSentence, planInput, questionFocus, talkBrief, worstLevel, type SlotId } from "@/engine";
import { agentName, mcpAddress, pairInstructions } from "@/mcp/pairing";
import { AnswererMark } from "./AnswererMark";
import { answererLogo, providerLabel, recipientsFor, pickDefault, STATE_TEXT, type Recipient, type RecipientId } from "./answerers";
import { ContextMenu, type MenuItem, type MenuRequest } from "./ContextMenu";
import { Icon } from "./icons";
import type { AiStatus, ProviderInfo } from "./Planner";
import { toSharedPlan, type ChatTurn } from "./store";
import type { AgentMessage, ClaudeActivity, Pairing } from "./usePairing";
import { newId, type PlanModel } from "./usePlans";
import { Logo, VerdictBadge, copyText, cx, undoHint, type Verdict } from "./ui";

/**
 * The one place to talk about the plan: a floating panel over the canvas, opened with Cmd+K, the
 * Ask button, a double-click on a part, or "Ask about this" on a right-click.
 *
 * One conversation per plan. The "Answering" menu picks who gets the next message:
 *   - a coding agent in a terminal (Claude Code, Codex, Gemini CLI). The message waits in the
 *     shared plan's inbox until the agent picks it up with wait_for_message; it works in the repo
 *     and answers with send_message.
 *   - a built-in AI with a key (Claude, OpenAI, Gemini and others). It answers from StackWise's
 *     facts and checks, never from memory.
 *   - StackWise's facts, with no AI at all.
 * Suggested notes and switches only change the plan when the person accepts them, as one
 * undoable step, and a switch always shows the verdict StackWise's rules give it.
 */

/** A question to send as soon as the panel is showing, from a menu like "Explain this connection". */
export interface AskRequest {
  slot: SlotId;
  question?: string;
  nonce: number;
  /** Who it goes to, when a menu names someone ("Build this with Claude Code"); otherwise the picked answerer. */
  to?: RecipientId;
}

const SUGGESTIONS = ["How do I set this up?", "Which keys does it need?", "What could go wrong?", "What else would work?", "Write a note for me"];
const EXPLAIN = "Explain my plan";
const HISTORY_TURNS = 20;

interface TalkResponse {
  by: "ai" | "facts";
  provider?: ProviderInfo["id"];
  reply: string;
  /** The part the answer is about, when the question named another one. */
  about?: SlotId;
  proposal?: { text: string; summary: string };
  swap?: { optionId: string; name: string; verdict: Verdict };
  note?: string;
  error?: string;
}

const now = () => new Date().toISOString();

/** Plain text with "- " and "1. " lines shown as lists. Nothing else is interpreted. */
function Formatted({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n").map((line) => line.trim());
  let i = 0;
  while (i < lines.length) {
    const ordered = /^\d+\.\s/.test(lines[i]);
    if (ordered || /^[-*]\s/.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\.\s/ : /^[-*]\s/).test(lines[i])) items.push(lines[i++].replace(/^(\d+\.|[-*])\s+/, ""));
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={blocks.length}>
          {items.map((item, n) => (
            <li key={n}>{item}</li>
          ))}
        </Tag>,
      );
    } else {
      if (lines[i]) blocks.push(<p key={blocks.length}>{lines[i]}</p>);
      i++;
    }
  }
  return <>{blocks}</>;
}

function StateDot({ state }: { state: Recipient["state"] }) {
  const on = state === "listening" || state === "working" || state === "ready";
  return <span className={cx("ws-status-dot", on && "is-on", state === "stopped" && "is-warn")} aria-hidden />;
}

function Turn({ model, turn, ai, onToast }: { model: PlanModel; turn: ChatTurn; ai: AiStatus | null; onToast: (message: string) => void }) {
  const { plan, rec, index, catalog, dispatch } = model;
  const slot = turn.about;
  const hasNote = Boolean(plan.notes[slot]?.text.trim());
  const optionId = rec.selection[slot] || undefined;
  const swapOption = turn.swap ? index.optionsById.get(turn.swap.optionId) : undefined;
  // The verdict for a suggested switch is always StackWise's, worked out now against the current plan.
  const swapVerdict: Verdict | undefined =
    swapOption && turn.swap?.status === "open"
      ? worstLevel(evaluatePlan(index, { ...rec.selection, [slot]: swapOption.id }, planInput(toSharedPlan(plan))).filter((r) => r.slots.includes(slot)))
      : undefined;

  if (turn.role === "you") {
    return (
      <div className="ws-turn ws-turn--you">
        <Formatted text={turn.text} />
      </div>
    );
  }

  return (
    <div className={cx("ws-turn", `ws-turn--${turn.role}`)}>
      <span className="ws-turn__who">{turn.role === "claude" ? providerLabel(ai, turn.by) : "StackWise facts"}</span>
      <div className="ws-turn__text">
        <Formatted text={turn.text} />
      </div>

      {turn.proposal && turn.proposal.status === "open" && (
        <div className="ws-suggest">
          <span className="mk-eyebrow">Suggested note on {inSentence(index.slotsById.get(slot)?.label ?? slot)}</span>
          <p className="mk-hint">{turn.proposal.summary}</p>
          <pre className="ws-suggest__note">{turn.proposal.text}</pre>
          <div className="mk-row mk-gap-2 mk-wrap mk-sm">
            <button
              type="button"
              className="mk-btn mk-btn--primary"
              onClick={() => {
                dispatch({ type: "useNote", slot, text: turn.proposal!.text, mode: "replace", by: turn.role === "claude" ? "claude" : "you", optionId, at: now(), turnId: turn.id });
                onToast(`Note updated. ${undoHint()}`);
              }}
            >
              {hasNote ? "Replace my note" : "Use as the note"}
            </button>
            {hasNote && (
              <button
                type="button"
                className="mk-btn mk-btn--secondary"
                onClick={() => {
                  dispatch({ type: "useNote", slot, text: turn.proposal!.text, mode: "append", by: turn.role === "claude" ? "claude" : "you", optionId, at: now(), turnId: turn.id });
                  onToast(`Added to the note. ${undoHint()}`);
                }}
              >
                Add to my note
              </button>
            )}
            <button type="button" className="mk-btn mk-btn--ghost" onClick={() => dispatch({ type: "dismissSuggestion", turnId: turn.id, what: "proposal" })}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {turn.proposal && turn.proposal.status !== "open" && (
        <p className="mk-hint">{turn.proposal.status === "used" ? "Used as the note." : turn.proposal.status === "added" ? "Added to the note." : "Note suggestion dismissed."}</p>
      )}

      {turn.swap && turn.swap.status === "open" && swapOption && swapOption.id !== optionId && (
        <div className="ws-suggest">
          <span className="mk-eyebrow">Suggested switch</span>
          <div className="mk-row mk-gap-2 mk-wrap">
            <Logo logo={catalog.logos[swapOption.id]} name={swapOption.name} size={22} />
            <strong>{swapOption.name}</strong>
            {swapVerdict && <VerdictBadge level={swapVerdict} short />}
          </div>
          <p className="mk-hint">Checked by StackWise&apos;s rules, not the AI.</p>
          <div className="mk-row mk-gap-2 mk-wrap mk-sm">
            <button
              type="button"
              className="mk-btn mk-btn--primary"
              onClick={() => {
                dispatch({ type: "useSwap", slot, optionId: swapOption.id, turnId: turn.id });
                onToast(`Switched to ${swapOption.name}. ${undoHint()}`);
              }}
            >
              Switch to {swapOption.name}
            </button>
            <button type="button" className="mk-btn mk-btn--ghost" onClick={() => dispatch({ type: "dismissSuggestion", turnId: turn.id, what: "swap" })}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {turn.swap && turn.swap.status !== "open" && swapOption && <p className="mk-hint">{turn.swap.status === "used" ? `Switched to ${swapOption.name}.` : "Switch dismissed."}</p>}
    </div>
  );
}

function AgentTurn({ message }: { message: AgentMessage }) {
  const name = agentName(message.agent);
  if (message.from === "you") {
    return (
      <div className="ws-turn ws-turn--you ws-turn--to-agent">
        <Formatted text={message.text} />
        <span className="ws-turn__meta">
          To {name}, {message.deliveredAt ? "picked up" : "waiting"}
        </span>
      </div>
    );
  }
  return (
    <div className="ws-turn ws-turn--agent">
      <span className="ws-turn__who">
        <Icon name="terminal" size={11} /> {name}
        {message.status === "working" && " is working"}
        {message.status === "needs_you" && " needs you"}
      </span>
      <div className="ws-turn__text">
        <Formatted text={message.text} />
      </div>
      {message.files && message.files.length > 0 && (
        <div className="ws-files">
          {message.files.map((file) => (
            <code key={file}>{file}</code>
          ))}
        </div>
      )}
    </div>
  );
}

const TOOL_LABELS: Record<string, string> = {
  update_plan: "Changed the plan",
  check_stack: "Checked a stack",
  recommend_stack: "Recommended a stack",
  compare_options: "Compared options",
  estimate_costs: "Estimated costs",
  export_project: "Exported the project",
  sync_plan_file: "Merged the plan file",
};

function ActivityRow({ activity }: { activity: ClaudeActivity }) {
  return (
    <div className={cx("ws-activity-row", activity.tool === "update_plan" && "is-change")}>
      <span>
        <strong>{TOOL_LABELS[activity.tool] ?? activity.tool}:</strong> {activity.summary}
      </span>
      {activity.changes.length > 0 && (
        <ul>
          {activity.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The one-line command that adds StackWise's MCP server, for agents whose CLI has one. The rest get the address. */
const ADD_COMMANDS: Record<string, (url: string) => string> = {
  "claude-code": (url) => `claude mcp add --transport http --scope user stackwise ${url}`,
  codex: (url) => `codex mcp add stackwise --url ${url}`,
  "gemini-cli": (url) => `gemini mcp add --transport http --scope user stackwise ${url}`,
  "qwen-code": (url) => `qwen mcp add --transport http --scope user stackwise ${url}`,
};

/** How to get an agent listening, shown when the picked agent isn't. */
export function ConnectCard({ recipient, pairing, onToast }: { recipient: Recipient; pairing: Pairing; onToast: (message: string) => void }) {
  const id = recipient.id.slice("agent:".length);
  const url = mcpAddress(window.location.origin);
  const claude = id === "claude-code";
  const command = ADD_COMMANDS[id]?.(url);
  const add = command ?? url;
  const copy = async (text: string, done: string) => onToast((await copyText(text)) ? done : text);
  const title =
    recipient.state === "stopped"
      ? `${recipient.label} stopped listening.`
      : recipient.state === "connected"
        ? `${recipient.label} isn't listening.`
        : `${recipient.label} isn't set up yet.`;

  return (
    <div className="ws-connect">
      <strong>{title}</strong>
      <ol>
        {recipient.state === "not-connected" && (
          <li>
            <span>{command ? "Run this once in a terminal:" : `Connect ${recipient.label} to StackWise once. Add this address:`}</span>
            <button type="button" className="ws-agent__cmd" onClick={() => void copy(add, command ? "Copied. Run it in a terminal." : "Copied the MCP address.")}>
              <code>{add}</code>
              <span className="mk-hint">Copy</span>
            </button>
          </li>
        )}
        <li>
          <span>{claude ? "Then run this in Claude Code:" : `Then paste this into ${recipient.label}:`}</span>
          {claude ? (
            <button type="button" className="ws-agent__cmd" onClick={() => void copy("/mcp__stackwise__pair", "Copied. Paste it into Claude Code.")}>
              <code>/mcp__stackwise__pair</code>
              <span className="mk-hint">Copy</span>
            </button>
          ) : (
            <button type="button" className="ws-agent__cmd" onClick={() => void copy(pairInstructions(id), `Copied. Paste it into ${recipient.label}.`)}>
              <code>Pairing instructions</code>
              <span className="mk-hint">Copy</span>
            </button>
          )}
        </li>
      </ol>
      {!pairing.enabled && (
        <label className="ws-agent__toggle">
          <span className="mk-stack mk-gap-1">
            <strong>Share this plan with agents</strong>
            <span className="mk-hint">Agents can only read a shared plan. Sending a message turns this on.</span>
          </span>
          <input type="checkbox" role="switch" className="ws-switch" checked={pairing.enabled} onChange={(e) => pairing.setEnabled(e.target.checked)} />
        </label>
      )}
      <span className="mk-hint">Write now. It waits until {recipient.label} listens.</span>
    </div>
  );
}

type Item = { at: string; key: string; about?: SlotId; node: ReactNode };

export function AskPanel({
  model,
  ai,
  slot,
  request,
  pairing,
  savedDefault,
  onSaveDefault,
  onSlot,
  onClose,
  onToast,
}: {
  model: PlanModel;
  ai: AiStatus | null;
  slot: SlotId;
  request: AskRequest | null;
  pairing: Pairing;
  /** The answerer saved as the default in this browser, shared with the Connect screen. */
  savedDefault: string | null;
  onSaveDefault: (id: RecipientId) => void;
  onSlot: (slot: SlotId) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const { plan, rec, index, catalog, dispatch } = model;
  const [chosen, setChosen] = useState<RecipientId | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlyThis, setOnlyThis] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handled = useRef<number | null>(null);

  const recipients = recipientsFor(ai, pairing);
  // A menu that names someone ("Build this with Codex") shows that conversation until the person picks another.
  const requested = request?.to && recipients.some((r) => r.id === request.to) ? request.to : undefined;
  const recipientId = chosen ?? requested ?? pickDefault(recipients, savedDefault);
  const recipient = recipients.find((r) => r.id === recipientId) ?? recipients.find((r) => r.id === "facts")!;
  const agent = recipient.group === "agent" ? recipient.id.slice("agent:".length) : null;

  const option = rec.selection[slot] ? index.optionsById.get(rec.selection[slot]!) : undefined;
  const aboutLabel = (id: SlotId) => {
    if (id === "framework") return plan.appName.trim() || "Your app";
    const picked = rec.selection[id] ? index.optionsById.get(rec.selection[id]!) : undefined;
    return picked ? `${picked.name} (${index.slotsById.get(id)?.label})` : (index.slotsById.get(id)?.label ?? id);
  };
  const subject = slot === "framework" ? plan.appName.trim() || "your app" : option ? option.name : inSentence(index.slotsById.get(slot)?.label ?? slot);
  const parts = catalog.slots.filter((s) => s.id === "framework" || rec.selection[s.id] || rec.needed.includes(s.id));
  const current = rec.selection[slot];

  // One timeline: the built-in AI's turns (in this browser) and the agents' messages and changes (on the server).
  const items = useMemo(() => {
    const list: Item[] = plan.chat.map((turn) => ({ at: turn.at, key: `t-${turn.id}`, about: turn.about, node: <Turn model={model} turn={turn} ai={ai} onToast={onToast} /> }));
    // An agent's reply is about whatever the person last asked that agent.
    const lastAbout: Record<string, SlotId | undefined> = {};
    for (const message of pairing.messages) {
      if (message.from === "you") lastAbout[message.agent] = message.about;
      list.push({ at: message.at, key: `m-${message.id}`, about: message.from === "you" ? message.about : lastAbout[message.agent], node: <AgentTurn message={message} /> });
    }
    for (const activity of pairing.activity) list.push({ at: activity.at, key: `a-${activity.id}`, node: <ActivityRow activity={activity} /> });
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [plan.chat, pairing.messages, pairing.activity, model, ai, onToast]);
  const shown = onlyThis ? items.filter((item) => item.about === slot) : items;
  const mixed = new Set(items.map((i) => i.about).filter(Boolean)).size > 1;

  // What the picked agent is doing with the last thing the person wrote to it.
  const pending = useMemo(() => {
    if (!agent) return null;
    const mine = pairing.messages.filter((m) => m.agent === agent);
    const lastAsk = [...mine].reverse().find((m) => m.from === "you");
    if (!lastAsk) return null;
    const answered = mine.some((m) => m.from === "agent" && m.at > lastAsk.at && m.status !== "working");
    if (answered) return null;
    return lastAsk.deliveredAt ? `${agentName(agent)} is working on it...` : `Waiting for ${agentName(agent)} to pick this up.`;
  }, [agent, pairing.messages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [shown.length, busy, pending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [slot, recipientId]);

  const say = (role: ChatTurn["role"], text: string, extra: Partial<ChatTurn> = {}) => dispatch({ type: "addTurns", turns: [{ id: newId(), role, text, at: now(), about: slot, ...extra }] });

  const explain = async (factsOnly: boolean, provider?: ProviderInfo["id"]) => {
    say("you", EXPLAIN);
    setBusy(true);
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appName: plan.appName, description: plan.description, answers: plan.answers, size: plan.size, priority: plan.priority, pinned: plan.pinned, factsOnly, provider }),
      });
      const result = (await response.json()) as { text?: string; by?: string; provider?: ProviderInfo["id"]; note?: string; error?: string };
      say(result.by === "ai" ? "claude" : "facts", result.text ?? result.error ?? "Couldn't explain the plan.", result.provider ? { by: result.provider } : {});
      if (result.note) onToast(result.note);
    } catch {
      say("facts", "Couldn't reach the server to explain the plan.");
    } finally {
      setBusy(false);
    }
  };

  const ask = async (text: string, to?: RecipientId) => {
    const q = text.trim();
    if (!q || busy) return;
    setQuestion("");

    const toAgent = to?.startsWith("agent:") ? to.slice("agent:".length) : agent;
    if (toAgent) {
      setBusy(true);
      const error = await pairing.send(toAgent, q, slot);
      setBusy(false);
      if (error) {
        setQuestion(q);
        onToast(error);
      }
      return;
    }

    const factsOnly = recipient.id === "facts";
    const provider = recipient.group === "api" ? (recipient.id.slice("api:".length) as ProviderInfo["id"]) : undefined;
    if (q === EXPLAIN) return explain(factsOnly, provider);
    const shared = toSharedPlan(plan);
    // A question can name another part or service ("Supabase instead of Firebase for the database?"): it's about that part.
    const focus = questionFocus(index, shared, slot, q);
    const about = focus.slot;
    if (about !== slot) onSlot(about);
    // Only the recent turns about this part go along, so a long chat about other parts costs nothing extra.
    const history = plan.chat
      .filter((t) => t.about === about)
      .slice(-HISTORY_TURNS)
      .map((t) => ({ role: t.role, text: t.text }));
    say("you", q, { about });
    setBusy(true);
    const answer = (body: Pick<TalkResponse, "reply" | "proposal" | "provider"> & { by: TalkResponse["by"]; swapId?: string }) =>
      say(body.by === "ai" ? "claude" : "facts", body.reply, {
        about,
        ...(body.provider ? { by: body.provider } : {}),
        ...(body.proposal ? { proposal: { ...body.proposal, status: "open" as const } } : {}),
        ...(body.swapId ? { swap: { optionId: body.swapId, status: "open" as const } } : {}),
      });
    try {
      const response = await fetch("/api/talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: shared, slot, question: q, history, factsOnly, provider }) });
      const body = (await response.json()) as TalkResponse;
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      answer({ by: body.by, provider: body.provider, reply: body.reply, proposal: body.proposal, swapId: body.swap?.optionId });
      if (body.note) onToast(body.note);
    } catch {
      // The server is unreachable: StackWise's facts still answer, right here in the browser.
      const local = answerFromFacts(talkBrief(index, shared, about, focus.mentioned), q);
      answer({ by: "facts", reply: local.reply, proposal: local.proposal, swapId: local.swap });
      onToast("Couldn't reach StackWise's server. Answered here from StackWise's facts.");
    } finally {
      setBusy(false);
    }
  };

  // A question sent from a menu, once per request.
  useEffect(() => {
    if (!request?.question || request.slot !== slot || handled.current === request.nonce) return;
    handled.current = request.nonce;
    void ask(request.question, request.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per request, not per render of ask
  }, [request, slot]);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const entry = (r: Recipient): MenuItem => ({
      label: r.label,
      lead: answererLogo(r.id) ? (
        <AnswererMark id={r.id} className="ws-menu-logo" />
      ) : (
        <StateDot state={r.state} />
      ),
      hint: STATE_TEXT[r.state],
      checked: r.id === recipientId,
      disabled: r.state === "needs-key",
      onSelect: () => setChosen(r.id),
    });
    const isDefault = savedDefault === recipientId;
    setMenu({
      x: box.left,
      y: box.bottom + 6,
      items: [
        { kind: "header", label: "Terminal agents" },
        ...recipients.filter((r) => r.group === "agent").map(entry),
        { kind: "header", label: "AI with a key" },
        ...recipients.filter((r) => r.group === "api").map(entry),
        { kind: "header", label: "No AI" },
        ...recipients.filter((r) => r.group === "facts").map(entry),
        { kind: "separator" },
        {
          label: isDefault ? `${recipient.label} is your default` : `Make ${recipient.label} the default`,
          icon: "pin",
          disabled: isDefault,
          onSelect: () => {
            onSaveDefault(recipientId);
            onToast(`${recipient.label} answers by default in this browser.`);
          },
        },
        { label: "Share this plan with agents", icon: "link", checked: pairing.enabled, onSelect: () => pairing.setEnabled(!pairing.enabled) },
      ],
    });
  };

  const chips = slot === "framework" ? [EXPLAIN, ...SUGGESTIONS.slice(0, 3)] : SUGGESTIONS;
  const showConnect = recipient.group === "agent" && recipient.state !== "listening" && recipient.state !== "working";
  const foot =
    recipient.group === "agent"
      ? `${recipient.label} · ${STATE_TEXT[recipient.state]}`
      : recipient.group === "api"
        ? recipient.state === "ready"
          ? "Answers from StackWise's facts and checks."
          : `Add a key in the AI menu (top right) to use ${recipient.label}.`
        : "StackWise's facts, no AI.";

  return (
    <section
      className="ws-ask"
      role="dialog"
      aria-label="Ask about your plan"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !menu) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="ws-ask__head">
        <button type="button" className="ws-answerer" aria-haspopup="menu" onClick={openMenu} title="Who answers">
          <StateDot state={recipient.state} />
          {answererLogo(recipient.id) ? (
            <AnswererMark id={recipient.id} className="ws-menu-logo" />
          ) : recipient.group === "agent" ? (
            <Icon name="terminal" size={13} />
          ) : (
            <Icon name="sparkle" size={13} />
          )}
          <span>{recipient.label}</span>
          <Icon name="down" size={11} />
        </button>
        <label className="ws-ask__about" title="What you're asking about">
          {current && <Logo logo={catalog.logos[current]} name={aboutLabel(slot)} size={16} />}
          <select aria-label="What to ask about" value={slot} onChange={(e) => onSlot(e.target.value as SlotId)}>
            {parts.map((s) => (
              <option key={s.id} value={s.id}>
                {aboutLabel(s.id)}
              </option>
            ))}
          </select>
          <Icon name="down" size={11} />
        </label>
        <button type="button" className="ws-iconbtn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="ws-ask__body" ref={listRef}>
        {mixed && (
          <button type="button" className={cx("ws-chip ws-ask__filter", onlyThis && "is-on")} aria-pressed={onlyThis} onClick={() => setOnlyThis((v) => !v)}>
            {onlyThis ? `Showing only ${aboutLabel(slot)}` : `Show only ${aboutLabel(slot)}`}
          </button>
        )}
        {showConnect && <ConnectCard recipient={recipient} pairing={pairing} onToast={onToast} />}
        {shown.length === 0 && !busy ? (
          <div className="ws-ask__empty">
            <p>
              {agent
                ? `Ask ${recipient.label} to change the plan or build something in your project. It answers here.`
                : `Ask about ${subject}. Nothing changes until you accept it.`}
            </p>
            <div className="ws-chips">
              {chips.map((s) => (
                <button key={s} type="button" className="ws-chip" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ws-thread">
            {shown.map((item) => (
              <div key={item.key} className="ws-thread__item">
                {item.node}
              </div>
            ))}
            {busy && !agent && (
              <div className="ws-turn ws-turn--claude is-busy">
                <span className="ws-turn__who">{recipient.group === "api" ? recipient.label : "StackWise facts"}</span>
                <p>Thinking about {slot === "framework" ? "your plan" : subject}...</p>
              </div>
            )}
            {pending && <p className="ws-ask__pending">{pending}</p>}
          </div>
        )}
      </div>

      <form
        className="ws-ask__compose"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <textarea
          ref={inputRef}
          aria-label={`Message to ${recipient.label}`}
          rows={1}
          value={question}
          placeholder={agent ? `Message ${recipient.label} about ${subject}` : `Ask about ${subject}`}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <button type="submit" className="ws-ask__send" disabled={busy || !question.trim()} aria-label="Send">
          <Icon name="send" size={15} />
        </button>
      </form>
      <div className="ws-ask__foot">
        <span>{foot}</span>
        {plan.chat.length > 0 && (
          <button type="button" className="ws-link ws-ask__clear" title="Clears the built-in AI's answers in this browser. Agent messages stay with the shared plan." onClick={() => dispatch({ type: "clearChat" })}>
            Clear
          </button>
        )}
      </div>
      <ContextMenu request={menu} onClose={() => setMenu(null)} />
    </section>
  );
}
