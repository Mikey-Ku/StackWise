"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { answerFromFacts, evaluatePlan, inSentence, planInput, questionFocus, talkBrief, worstLevel, type SlotId } from "@/engine";
import { agentName, mcpAddress, pairInstructions } from "@/mcp/pairing";
import { AnswererMark } from "./AnswererMark";
import { describeAgentModel, wantsLongContext, answererLogo, providerLabel, providersOf, recipientsFor, pickDefault, saveProviderSetting, STATE_TEXT, type Recipient, type RecipientId } from "./answerers";
import { ContextMenu, type MenuItem, type MenuRequest } from "./ContextMenu";
import { Icon, type IconName } from "./icons";
import { PanelEdge } from "./PanelEdge";
import type { AiStatus, ProviderInfo } from "./Planner";
import { toSharedPlan, type ChatTurn } from "./store";
import type { AgentMessage, ClaudeActivity, Pairing } from "./usePairing";
import { newId, type PlanModel } from "./usePlans";
import { Logo, VerdictBadge, copyText, cx, undoHint, type Verdict } from "./ui";

/**
 * The one place to talk about the plan: a chat pane docked on the left of the canvas, opened
 * with Cmd+K, the Ask button, a double-click on a part, or "Ask about this" on a right-click.
 *
 * One conversation per plan. The composer picks who answers in two steps, like any chat app:
 * the provider (Claude, ChatGPT, Gemini, or StackWise's own facts with no AI), then the model
 * under it, where a coding agent in the terminal (Claude Code, Codex, Gemini CLI) sits next to
 * the API's models. A message to an agent waits in the shared plan's inbox until the agent
 * picks it up with wait_for_message; it works in the repo and answers with send_message. A
 * built-in AI answers from StackWise's facts and checks, never from memory. Suggested notes and
 * switches only change the plan when the person accepts them, as one undoable step, and a switch
 * always shows the verdict StackWise's rules give it.
 */

/** A question to send as soon as the panel is showing, from a menu like "Explain this connection". */
export interface AskRequest {
  slot: SlotId;
  question?: string;
  nonce: number;
  /** Who it goes to, when a menu names someone ("Build this with Claude Code"); otherwise the picked answerer. */
  to?: RecipientId;
}

const EXPLAIN = "Explain my plan";
const HISTORY_TURNS = 20;
/** What a question carries besides the conversation: the part's brief (facts, checks, setup), about this many characters. */
const BRIEF_CHARS = 6000;
const CHARS_PER_TOKEN = 4;

interface Starter {
  label: string;
  icon: IconName;
}
/** What to start with about the whole app, and about one part. */
const APP_STARTERS: Starter[] = [
  { label: EXPLAIN, icon: "sparkle" },
  { label: "What could go wrong?", icon: "info" },
  { label: "Which keys do I need?", icon: "note" },
  { label: "What else would work?", icon: "swap" },
];
const PART_STARTERS: Starter[] = [
  { label: "How do I set this up?", icon: "checklist" },
  { label: "Which keys does it need?", icon: "note" },
  { label: "What could go wrong?", icon: "info" },
  { label: "What else would work?", icon: "swap" },
  { label: "Write a note for me", icon: "note" },
];
const AGENT_STARTER: Starter = { label: "Build the next task", icon: "terminal" };

/** The providers in the composer's first bubble, each with its terminal agent and its API. */
interface Provider {
  id: string;
  label: string;
  mark: RecipientId;
  agent?: string;
  api?: string;
}
const PROVIDERS: Provider[] = [
  { id: "claude", label: "Claude", mark: "api:claude", agent: "claude-code", api: "claude" },
  { id: "openai", label: "ChatGPT", mark: "api:openai", agent: "codex", api: "openai" },
  { id: "gemini", label: "Gemini", mark: "api:gemini", agent: "gemini-cli", api: "gemini" },
  { id: "facts", label: "StackWise", mark: "facts" },
];
/** A model's short name as the provider's page gives it, else its id. */
const modelNameOf = (api: ProviderInfo, id: string) => api.modelInfo?.find((x) => x.id === id)?.name ?? id;

/** The provider a recipient belongs to; an agent or API outside the list gets a provider of its own. */
function providerFor(id: RecipientId, ai: AiStatus | null): Provider {
  if (id === "facts") return PROVIDERS[3];
  if (id.startsWith("api:")) {
    const api = id.slice("api:".length);
    return PROVIDERS.find((p) => p.api === api) ?? { id: api, label: providerLabel(ai, api), mark: id, api };
  }
  const agent = id.slice("agent:".length);
  return PROVIDERS.find((p) => p.agent === agent) ?? { id: `agent-${agent}`, label: agentName(agent), mark: id, agent };
}
const BUILD_NEXT = "Build the next task: call get_build_plan, take the first task that isn't built yet, build it with its test plan, and reply here with what you did.";

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

/** How much of the model's context window the next message would use, as a ring that fills. */
function ContextRing({ used, window: limit }: { used: number; window: number }) {
  const share = Math.min(1, used / limit);
  const r = 5.5;
  const round = r * 2 * Math.PI;
  const label = `Context: about ${used < 1000 ? used : `${Math.round(used / 1000)}K`} of ${limit >= 1_000_000 ? `${(limit / 1_000_000).toFixed(limit % 1_000_000 ? 2 : 0)}M` : `${Math.round(limit / 1000)}K`} tokens`;
  return (
    <span className={cx("ws-ask__ctx", share > 0.8 && "is-full")} title={label} aria-label={label} role="img">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${Math.max(0.6, share * round)} ${round}`} transform="rotate(-90 8 8)" />
      </svg>
    </span>
  );
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
  onAi,
  width,
  fallbackWidth,
  onResize,
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
  /** The AI status after a model was picked here. */
  onAi: (ai: AiStatus) => void;
  /** The pane's width, dragged from its edge and kept per browser. */
  width: number;
  fallbackWidth: number;
  onResize: (width: number) => void;
  onSlot: (slot: SlotId) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const { plan, rec, index, dispatch } = model;
  const router = useRouter();
  const [chosen, setChosen] = useState<RecipientId | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlyThis, setOnlyThis] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  /** What each terminal agent is set to, from /api/agents: for Claude Code, the model its new sessions start with. */
  const [agentModels, setAgentModels] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let stopped = false;
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { agents?: { id: string; model?: string | null }[] } | null) => {
        if (!stopped && body?.agents) setAgentModels(Object.fromEntries(body.agents.map((a) => [a.id, a.model ?? null])));
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handled = useRef<number | null>(null);

  const recipients = recipientsFor(ai, pairing);
  // A menu that names someone ("Build this with Codex") shows that conversation until the person picks another.
  const requested = request?.to && recipients.some((r) => r.id === request.to) ? request.to : undefined;
  const recipientId = chosen ?? requested ?? pickDefault(recipients, savedDefault);
  const recipient = recipients.find((r) => r.id === recipientId) ?? recipients.find((r) => r.id === "facts")!;
  const agent = recipient.group === "agent" ? recipient.id.slice("agent:".length) : null;
  const provider = providerFor(recipient.id, ai);
  const api = provider.api ? providersOf(ai).find((p) => p.id === provider.api) : undefined;
  const agentRecipientOf = (p: Provider) => (p.agent ? recipients.find((r) => r.id === `agent:${p.agent}`) : undefined);
  const agentRecipient = agentRecipientOf(provider);
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "\u2318" : "Ctrl+";

  const option = rec.selection[slot] ? index.optionsById.get(rec.selection[slot]!) : undefined;
  const aboutLabel = (id: SlotId) => {
    if (id === "framework") return plan.appName.trim() || "Your app";
    const picked = rec.selection[id] ? index.optionsById.get(rec.selection[id]!) : undefined;
    return picked ? `${picked.name} (${index.slotsById.get(id)?.label})` : (index.slotsById.get(id)?.label ?? id);
  };
  const subject = slot === "framework" ? plan.appName.trim() || "your app" : option ? option.name : inSentence(index.slotsById.get(slot)?.label ?? slot);

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

  // What the picked agent is doing with the last thing the person wrote to it. Cheap enough to work out each render.
  const pendingFor = (id: string | null): string | null => {
    if (!id) return null;
    const mine = pairing.messages.filter((m) => m.agent === id);
    const lastAsk = [...mine].reverse().find((m) => m.from === "you");
    if (!lastAsk) return null;
    const answered = mine.some((m) => m.from === "agent" && m.at > lastAsk.at && m.status !== "working");
    if (answered) return null;
    return lastAsk.deliveredAt ? `${agentName(id)} is working on it...` : `Waiting for ${agentName(id)} to pick this up.`;
  };
  const pending = pendingFor(agent);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [shown.length, busy, pending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [slot, recipientId]);

  const say = (role: ChatTurn["role"], text: string, extra: Partial<ChatTurn> = {}) => dispatch({ type: "addTurns", turns: [{ id: newId(), role, text, at: now(), about: slot, ...extra }] });

  const explain = async (factsOnly: boolean, providerId?: ProviderInfo["id"]) => {
    say("you", EXPLAIN);
    setBusy(true);
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appName: plan.appName, description: plan.description, answers: plan.answers, size: plan.size, priority: plan.priority, pinned: plan.pinned, factsOnly, provider: providerId }),
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
    const providerId = recipient.group === "api" ? (recipient.id.slice("api:".length) as ProviderInfo["id"]) : undefined;
    if (q === EXPLAIN) return explain(factsOnly, providerId);
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
      const response = await fetch("/api/talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: shared, slot, question: q, history, factsOnly, provider: providerId }) });
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

  const pickModel = async (value: string) => {
    if (!api?.modelEnv) return;
    setSavingModel(true);
    try {
      onAi(await saveProviderSetting(api.modelEnv, value === api.defaultModel ? "" : value));
      onToast(`${provider.label} answers with ${value}.`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't change the model.");
    } finally {
      setSavingModel(false);
    }
  };

  /** Sets the model Claude Code starts its next sessions with, in its own settings file. */
  const setAgentModel = async (value: string) => {
    setSavingModel(true);
    try {
      const r = await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "model", agent: "claude-code", model: value }) });
      const body = (await r.json()) as { agents?: { id: string; model?: string | null }[]; error?: string };
      if (!r.ok || !body.agents) throw new Error(body.error ?? "Couldn't set Claude Code's model.");
      setAgentModels(Object.fromEntries(body.agents.map((a) => [a.id, a.model ?? null])));
      const d = describeAgentModel(value, api?.modelInfo ?? []);
      onToast(d ? `New Claude Code sessions start with ${d.name}${d.note ? ` (${d.note})` : ""}. A session already open switches with /model.` : "Claude Code is back on its own default model.");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't set Claude Code's model.");
    } finally {
      setSavingModel(false);
    }
  };

  /** Picking a provider takes its agent when that's listening, else its API. */
  const pickProvider = (p: Provider) => {
    const a = agentRecipientOf(p);
    const live = a && (a.state === "listening" || a.state === "working");
    setChosen(live ? a.id : p.api ? `api:${p.api}` : a ? a.id : "facts");
  };

  const openProviderMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const listed = PROVIDERS.some((p) => p.id === provider.id) ? PROVIDERS : [...PROVIDERS, provider];
    const isDefault = savedDefault === recipientId;
    setMenu({
      x: box.left,
      y: box.top - 6,
      items: [
        ...listed.map(
          (p): MenuItem => ({
            label: p.label,
            lead: <AnswererMark id={p.mark} className="ws-menu-logo" />,
            checked: p.id === provider.id,
            onSelect: () => pickProvider(p),
          }),
        ),
        { kind: "separator" },
        {
          label: isDefault ? `${recipient.label} is your default` : `Make ${recipient.label} the default`,
          icon: "pin",
          disabled: isDefault,
          onSelect: () => {
            onSaveDefault(recipientId);
            onToast(`${recipient.label} answers by default.`);
          },
        },
        { label: "Share this plan with agents", icon: "link", checked: pairing.enabled, onSelect: () => pairing.setEnabled(!pairing.enabled) },
        { label: "Keys and models in Settings", icon: "tool", onSelect: () => router.push("/settings#models") },
      ],
    });
  };

  /**
   * The second bubble: how the provider is reached (its agent in the terminal, or its API), then
   * the model. Through the API the model is StackWise's setting; through Claude Code it's the
   * model Claude Code's own settings start new sessions with, which StackWise can set too.
   */
  const agentModel = provider.agent ? (agentModels[provider.agent] ?? null) : null;
  const agentPick = api ? describeAgentModel(agentModel, api.modelInfo ?? []) : null;
  const longContext = wantsLongContext(agentModel);
  const openModelMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const items: MenuItem[] = [];
    if (agentRecipient || api) items.push({ kind: "header", label: "Through" });
    if (agentRecipient) items.push({ label: `${agentRecipient.label} in your terminal`, icon: "terminal", hint: STATE_TEXT[agentRecipient.state], checked: recipient.id === agentRecipient.id, onSelect: () => setChosen(agentRecipient.id) });
    if (api) items.push({ label: `The ${provider.label} API`, icon: "sparkle", hint: api.on ? "Key saved" : "Needs a key", checked: recipient.id === `api:${api.id}`, onSelect: () => setChosen(`api:${api.id}`) });
    const models = api?.models?.length ? api.models : api?.model ? [api.model] : [];
    const viaAgent = Boolean(agent);
    const canSet = api && models.length > 0 && (!viaAgent || provider.agent === "claude-code");
    if (api && canSet) {
      const current = api.model || api.defaultModel;
      const info = (id: string) => api.modelInfo?.find((x) => x.id === id);
      items.push({ kind: "separator" }, { kind: "header", label: viaAgent ? "Model for new Claude Code sessions" : "Model" });
      // Through Claude Code the setting is its own (an alias or an id, "[1m]" for the 1M window); the
      // menu reads it and writes it back the same way, so a pick keeps the window and the window keeps the pick.
      const picked = viaAgent ? (agentPick?.id ?? null) : null;
      if (viaAgent) {
        items.push({ label: "Claude Code's own default", checked: !picked, onSelect: () => void setAgentModel("") });
        if (picked && !models.includes(picked)) items.push({ label: `As Claude Code has it: ${agentPick!.raw}`, checked: true, onSelect: () => {} });
      }
      for (const m of models) {
        const known = info(m);
        items.push({
          label: `${known?.name ?? m}${!viaAgent && m === api.defaultModel ? " (default)" : ""}`,
          hint: known?.price,
          checked: viaAgent ? picked === m : recipient.id === `api:${api.id}` && current === m,
          onSelect: () => {
            if (viaAgent) {
              const next = `${m}${longContext ? "[1m]" : ""}`;
              if (next !== agentModel) void setAgentModel(next);
              return;
            }
            setChosen(`api:${api.id}`);
            if (m !== current) void pickModel(m);
          },
        });
      }
      if (viaAgent && picked) {
        items.push(
          { kind: "separator" },
          { kind: "header", label: "Context window" },
          { label: "Standard", checked: !longContext, onSelect: () => void (longContext && setAgentModel(picked)) },
          { label: "1M tokens", hint: "[1m]", checked: longContext, onSelect: () => void (!longContext && setAgentModel(`${picked}[1m]`)) },
        );
      }
      items.push({ kind: "separator" }, { label: "Another model, or a key", icon: "tool", onSelect: () => router.push("/settings#models") });
    }
    if (provider.id === "facts") items.push({ label: "Facts only, no AI", checked: true, onSelect: () => setChosen("facts") });
    setMenu({ x: box.left, y: box.top - 6, items });
  };
  // The ring: what the next message would send (this part's brief, the recent turns, the draft) against the model's window.
  const apiModelInfo = api && !agent ? api.modelInfo?.find((x) => x.id === (api.model || api.defaultModel)) : undefined;
  const contextUsed = Math.round(
    (BRIEF_CHARS +
      question.length +
      plan.chat
        .filter((t) => t.about === slot)
        .slice(-HISTORY_TURNS)
        .reduce((n, t) => n + t.text.length, 0)) /
      CHARS_PER_TOKEN,
  );

  // The bubble names the model alone, with a note for its window or mode; the provider bubble
  // already says whose it is. A placeholder (no key, facts only) reads quieter than a name.
  const modelShown: { name: string; note: string | null; placeholder: boolean } = agent
    ? agentPick?.id
      ? { name: agentPick.name, note: agentPick.note, placeholder: false }
      : { name: "Default model", note: null, placeholder: true }
    : provider.id === "facts"
      ? { name: "Facts only", note: null, placeholder: true }
      : api
        ? api.on
          ? { name: modelNameOf(api, api.model || api.defaultModel || "") || "Default model", note: null, placeholder: !(api.model || api.defaultModel) }
          : { name: "Needs a key", note: null, placeholder: true }
        : { name: recipient.label, note: null, placeholder: true };

  const listening = recipient.group === "agent" && (recipient.state === "listening" || recipient.state === "working");
  const starters = [...(slot === "framework" ? APP_STARTERS : PART_STARTERS), ...(listening ? [AGENT_STARTER] : [])];
  const start = (s: Starter) => void ask(s.label === AGENT_STARTER.label ? BUILD_NEXT : s.label);
  const showConnect = recipient.group === "agent" && recipient.state !== "listening" && recipient.state !== "working";
  const needsKey = recipient.group === "api" && recipient.state !== "ready";

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
      <header className="ws-ask__top">
        <button type="button" className="ws-iconbtn ws-ask__hide" onClick={onClose} aria-label="Hide the chat" title={`Hide the chat (${mod}K)`}>
          <Icon name="sidebar" size={16} />
        </button>
        <span className="ws-ask__spacer" title={slot === "framework" ? `About ${plan.appName.trim() || "Untitled app"}` : `About ${aboutLabel(slot)}. Right-click a part to ask about it; naming a part in a message works too.`} />
        <button
          type="button"
          className="ws-iconbtn ws-ask__new"
          disabled={plan.chat.length === 0}
          aria-label="New chat"
          title="New chat. Clears the built-in AI's answers in this browser; agent messages stay with the shared plan."
          onClick={() => {
            dispatch({ type: "clearChat" });
            onToast("New chat. Agent messages stay with the shared plan.");
          }}
        >
          <Icon name="plus" size={15} />
        </button>
        {mixed && (
          <button type="button" className={cx("ws-iconbtn", onlyThis && "is-on")} aria-pressed={onlyThis} title={onlyThis ? `Showing only ${aboutLabel(slot)}` : `Show only ${aboutLabel(slot)}`} onClick={() => setOnlyThis((v) => !v)}>
            <Icon name="target" size={14} />
          </button>
        )}
      </header>

      <div className="ws-ask__body" ref={listRef}>
        {showConnect && <ConnectCard recipient={recipient} pairing={pairing} onToast={onToast} />}
        {shown.length === 0 && !busy ? (
          <div className="ws-ask__empty">
            <p className="ws-ask__lead">{agent ? `Ask ${recipient.label} to change the plan or build in your project, or start with:` : "Ask anything, or start with:"}</p>
            <div className="ws-starts">
              {starters.map((s) => (
                <button key={s.label} type="button" className="ws-start" onClick={() => start(s)}>
                  <Icon name={s.icon} size={15} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
            {!agent && <p className="mk-hint">About {subject}. Nothing changes until you accept it.</p>}
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
                <span className="ws-turn__who">{recipient.group === "api" ? provider.label : "StackWise facts"}</span>
                <p>Thinking about {slot === "framework" ? "your plan" : subject}...</p>
              </div>
            )}
            {pending && <p className="ws-ask__pending">{pending}</p>}
          </div>
        )}
      </div>

      {needsKey && (
        <p className="ws-ask__notice">
          {provider.label} needs a key. <a href="/settings#models">Add it in Settings</a>, pick its terminal agent, or StackWise answers from its facts.
        </p>
      )}
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
          placeholder={agent ? `Message ${recipient.label} about ${subject}` : `Ask about ${subject}, or name another part`}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <div className="ws-ask__tools">
          <button type="button" className="ws-answerer" aria-haspopup="menu" onClick={openProviderMenu} title={`Who answers: ${provider.label}, ${STATE_TEXT[recipient.state].toLowerCase()}`}>
            {answererLogo(provider.mark) ? <AnswererMark id={provider.mark} className="ws-menu-logo" /> : <Icon name="sparkle" size={13} />}
            <span>{provider.label}</span>
            <StateDot state={recipient.state} />
            <Icon name="down" size={11} />
          </button>
          <button type="button" className={cx("ws-answerer ws-answerer--model", modelShown.placeholder && "is-placeholder")} aria-haspopup="menu" disabled={savingModel} onClick={openModelMenu} title="Which model, or the agent in your terminal">
            <span>{modelShown.name}</span>
            {modelShown.note && <span className="ws-answerer__note">{modelShown.note}</span>}
            <Icon name="down" size={11} />
          </button>
          {apiModelInfo && <ContextRing used={contextUsed} window={apiModelInfo.contextTokens} />}
          <button type="submit" className="ws-ask__send" disabled={busy || !question.trim()} aria-label="Send">
            <Icon name="send" size={15} />
          </button>
        </div>
      </form>
      <ContextMenu request={menu} onClose={() => setMenu(null)} />
      <PanelEdge side="left" width={width} fallback={fallbackWidth} onResize={onResize} />
    </section>
  );
}
