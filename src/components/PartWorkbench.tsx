"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { answerFromFacts, evaluatePlan, inSentence, planInput, possessive, talkBrief, worstLevel, type SlotId } from "@/engine";
import { toSharedPlan, type ChatTurn } from "./store";
import { newId, type PlanModel } from "./usePlans";
import { Logo, VerdictBadge, cx, type Verdict } from "./ui";

/**
 * Where a part of the plan gets worked on: the person's note, and a conversation about the part.
 * Claude answers when it's on; otherwise WhyStack answers from its own facts. Either can suggest a
 * note or a switch, and nothing changes until the person accepts, as one undoable step.
 */

const SUGGESTIONS = ["How do I set this up?", "Which keys does it need?", "What could go wrong?", "What else would work?", "Write a note for me"];

interface TalkResponse {
  by: "ai" | "facts";
  reply: string;
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

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

function NoteEditor({ model, slot }: { model: PlanModel; slot: SlotId }) {
  const { plan, rec, index, dispatch } = model;
  const note = plan.notes[slot];
  const saved = note?.text ?? "";
  /** What's being typed. Null when the editor shows the saved note, so changes from Claude or undo appear. */
  const [draft, setDraft] = useState<string | null>(null);
  const optionId = rec.selection[slot] || undefined;
  const option = optionId ? index.optionsById.get(optionId) : undefined;
  const writtenFor = note?.optionId && optionId && note.optionId !== optionId ? index.optionsById.get(note.optionId)?.name ?? note.optionId : undefined;
  const value = draft ?? saved;

  useEffect(() => {
    if (draft === null || draft === saved) return;
    const timer = window.setTimeout(() => dispatch({ type: "editNote", slot, text: draft, optionId, at: now() }), 400);
    return () => window.clearTimeout(timer);
  }, [draft, saved, slot, optionId, dispatch]);

  return (
    <div className="mk-stack mk-gap-2">
      <div className="ws-work__head">
        <span className="mk-eyebrow">Note</span>
        {note && (
          <span className="mk-hint">
            {note.by === "claude" ? "Written by Claude" : "Saved"}, {ago(note.updatedAt)}
          </span>
        )}
      </div>
      {writtenFor && (
        <div className="ws-work__stale">
          <span>
            Written when this was {writtenFor}. Check that it still applies to {option?.name ?? "the new choice"}.
          </span>
          <button type="button" className="ws-link" onClick={() => dispatch({ type: "editNote", slot, text: saved, optionId, at: now() })}>
            It still applies
          </button>
        </div>
      )}
      <textarea
        className="mk-textarea ws-work__note"
        aria-label={`Note on ${option ? option.name : inSentence(index.slotsById.get(slot)?.label ?? slot)}`}
        value={value}
        rows={Math.min(10, Math.max(3, value.split("\n").length + 1))}
        placeholder={`How should ${option ? option.name : inSentence(index.slotsById.get(slot)?.label ?? slot)} work in your app? What did you decide, and what should whoever builds it know?`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== saved) dispatch({ type: "editNote", slot, text: draft, optionId, at: now() });
          setDraft(null);
        }}
      />
      <p className="mk-hint">Saved with the plan, shared in links, and written into the project for whoever builds it.</p>
    </div>
  );
}

function Turn({ model, slot, turn, onToast }: { model: PlanModel; slot: SlotId; turn: ChatTurn; onToast: (message: string) => void }) {
  const { plan, rec, index, catalog, dispatch } = model;
  const hasNote = Boolean(plan.notes[slot]?.text.trim());
  const optionId = rec.selection[slot] || undefined;
  const swapOption = turn.swap ? index.optionsById.get(turn.swap.optionId) : undefined;
  // The verdict for a suggested switch is always WhyStack's, worked out now against the current plan.
  const swapVerdict: Verdict | undefined =
    swapOption && turn.swap?.status === "open"
      ? worstLevel(evaluatePlan(index, { ...rec.selection, [slot]: swapOption.id }, planInput(toSharedPlan(plan))).filter((r) => r.slots.includes(slot)))
      : undefined;
  const who = turn.role === "you" ? "You" : turn.role === "claude" ? "Claude" : "WhyStack";

  return (
    <div className={cx("ws-turn", `ws-turn--${turn.role}`)}>
      <span className="ws-turn__who">{who}</span>
      <div className="ws-turn__text">
        <Formatted text={turn.text} />
      </div>

      {turn.proposal && turn.proposal.status === "open" && (
        <div className="ws-suggest">
          <span className="mk-eyebrow">Suggested note</span>
          <p className="mk-hint">{turn.proposal.summary}</p>
          <pre className="ws-suggest__note">{turn.proposal.text}</pre>
          <div className="mk-row mk-gap-2 mk-wrap">
            <button
              type="button"
              className="mk-btn mk-btn--primary mk-sm"
              onClick={() => {
                dispatch({ type: "useNote", slot, text: turn.proposal!.text, mode: "replace", by: turn.role === "claude" ? "claude" : "you", optionId, at: now(), turnId: turn.id });
                onToast("The note is updated. Undo reverses it.");
              }}
            >
              {hasNote ? "Replace my note" : "Use as the note"}
            </button>
            {hasNote && (
              <button
                type="button"
                className="mk-btn mk-btn--secondary mk-sm"
                onClick={() => {
                  dispatch({ type: "useNote", slot, text: turn.proposal!.text, mode: "append", by: turn.role === "claude" ? "claude" : "you", optionId, at: now(), turnId: turn.id });
                  onToast("Added to the note. Undo reverses it.");
                }}
              >
                Add to my note
              </button>
            )}
            <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => dispatch({ type: "dismissSuggestion", slot, turnId: turn.id, what: "proposal" })}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {turn.proposal && turn.proposal.status !== "open" && (
        <p className="mk-hint ws-turn__done">{turn.proposal.status === "used" ? "Used as the note." : turn.proposal.status === "added" ? "Added to the note." : "Note suggestion dismissed."}</p>
      )}

      {turn.swap && turn.swap.status === "open" && swapOption && swapOption.id !== optionId && (
        <div className="ws-suggest">
          <span className="mk-eyebrow">Suggested switch</span>
          <div className="mk-row mk-gap-2 mk-wrap">
            <Logo logo={catalog.logos[swapOption.id]} name={swapOption.name} size={22} />
            <strong>{swapOption.name}</strong>
            {swapVerdict && <VerdictBadge level={swapVerdict} short />}
          </div>
          <p className="mk-hint">That verdict is from WhyStack&apos;s rules, checked against the rest of your plan just now.</p>
          <div className="mk-row mk-gap-2 mk-wrap">
            <button
              type="button"
              className="mk-btn mk-btn--primary mk-sm"
              onClick={() => {
                dispatch({ type: "useSwap", slot, optionId: swapOption.id, turnId: turn.id });
                onToast(`Switched to ${swapOption.name}. Undo reverses it.`);
              }}
            >
              Switch to {swapOption.name}
            </button>
            <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => dispatch({ type: "dismissSuggestion", slot, turnId: turn.id, what: "swap" })}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {turn.swap && turn.swap.status !== "open" && swapOption && (
        <p className="mk-hint ws-turn__done">{turn.swap.status === "used" ? `Switched to ${swapOption.name}.` : "Switch dismissed."}</p>
      )}
    </div>
  );
}

function Talk({ model, slot, aiOn, onToast }: { model: PlanModel; slot: SlotId; aiOn: boolean | null; onToast: (message: string) => void }) {
  const { plan, rec, index, dispatch } = model;
  const thread = plan.threads[slot] ?? [];
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const option = rec.selection[slot] ? index.optionsById.get(rec.selection[slot]!) : undefined;
  const label = index.slotsById.get(slot)?.label ?? slot;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [thread.length, busy]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const shared = toSharedPlan(plan);
    const history = thread.map((t) => ({ role: t.role, text: t.text }));
    dispatch({ type: "addTurns", slot, turns: [{ id: newId(), role: "you", text: q, at: now() }] });
    setQuestion("");
    setBusy(true);
    const answer = (body: Pick<TalkResponse, "reply" | "proposal"> & { by: TalkResponse["by"]; swapId?: string }) =>
      dispatch({
        type: "addTurns",
        slot,
        turns: [
          {
            id: newId(),
            role: body.by === "ai" ? "claude" : "facts",
            text: body.reply,
            at: now(),
            ...(body.proposal ? { proposal: { ...body.proposal, status: "open" as const } } : {}),
            ...(body.swapId ? { swap: { optionId: body.swapId, status: "open" as const } } : {}),
          },
        ],
      });
    try {
      const response = await fetch("/api/talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: shared, slot, question: q, history }) });
      const body = (await response.json()) as TalkResponse;
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      answer({ by: body.by, reply: body.reply, proposal: body.proposal, swapId: body.swap?.optionId });
      if (body.note) onToast(body.note);
    } catch {
      // The server is unreachable: WhyStack's facts still answer, right here in the browser.
      const local = answerFromFacts(talkBrief(index, shared, slot), q);
      answer({ by: "facts", reply: local.reply, proposal: local.proposal, swapId: local.swap });
      onToast("Couldn't reach WhyStack's server, so this was answered in the browser from WhyStack's facts.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mk-stack mk-gap-2">
      <div className="ws-work__head">
        <span className="mk-eyebrow">Talk it through</span>
        <span className="mk-row mk-gap-2">
          <span className={cx("mk-badge", aiOn ? "mk-badge--accent" : "ws-badge--unknown")} title={aiOn ? "Claude answers, using only what WhyStack knows about this part." : "Set ANTHROPIC_API_KEY in .env.local to talk with Claude."}>
            {aiOn ? "Claude" : "Facts only"}
          </span>
          {thread.length > 0 && (
            <button type="button" className="ws-link" onClick={() => dispatch({ type: "clearThread", slot })}>
              Clear
            </button>
          )}
        </span>
      </div>

      {thread.length === 0 ? (
        <p className="mk-hint">
          Ask anything about {option ? option.name : inSentence(label)}: setting it up, its keys, what could go wrong, what else would work.{" "}
          {aiOn
            ? "Claude answers from WhyStack's facts and checks, and can suggest a note or a switch for you to accept."
            : `Claude is off, so WhyStack answers from its own facts. Add ANTHROPIC_API_KEY to .env.local to talk with Claude.`}
        </p>
      ) : (
        <div className="ws-thread" ref={listRef}>
          {thread.map((turn) => (
            <Turn key={turn.id} model={model} slot={slot} turn={turn} onToast={onToast} />
          ))}
          {busy && (
            <div className="ws-turn ws-turn--claude is-busy">
              <span className="ws-turn__who">{aiOn ? "Claude" : "WhyStack"}</span>
              <div className="ws-turn__text">
                <p>Thinking about {option ? possessive(option.name) : "this part's"} setup...</p>
              </div>
            </div>
          )}
        </div>
      )}

      {thread.length === 0 && (
        <div className="ws-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="ws-chip" disabled={busy} onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="ws-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <textarea
          className="mk-textarea"
          aria-label={`Ask about ${option ? option.name : inSentence(label)}`}
          rows={2}
          value={question}
          placeholder={`Ask about ${option ? option.name : inSentence(label)}`}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <button type="submit" className="mk-btn mk-btn--primary mk-sm" disabled={busy || !question.trim()}>
          {busy ? "..." : "Ask"}
        </button>
      </form>
    </div>
  );
}

export function PartWorkbench({ model, slot, aiOn, onToast }: { model: PlanModel; slot: SlotId; aiOn: boolean | null; onToast: (message: string) => void }) {
  return (
    <section className="ws-work" aria-label="Note and conversation">
      <NoteEditor key={`note-${model.plan.id}-${slot}`} model={model} slot={slot} />
      <Talk key={`talk-${model.plan.id}-${slot}`} model={model} slot={slot} aiOn={aiOn} onToast={onToast} />
    </section>
  );
}
