"use client";

import { useEffect, useRef, useState } from "react";
import type { ClaudeActivity } from "./usePairing";
import { VerdictBadge, copyText, cx, type Verdict } from "./ui";

const TOOL_LABELS: Record<string, string> = {
  update_plan: "Changed the plan",
  check_stack: "Checked a stack",
  recommend_stack: "Recommended a stack",
  compare_options: "Compared options",
  estimate_costs: "Estimated costs",
  export_project: "Exported the project",
};

const VERDICTS = new Set(["blocked", "missing", "warning", "unknown", "info", "works"]);

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** How to connect Claude, and the switch that shares the open plan. */
export function PairDialog({
  open,
  enabled,
  reachable,
  onToggle,
  onClose,
  onToast,
}: {
  open: boolean;
  enabled: boolean;
  reachable: boolean | null;
  onToggle: (on: boolean) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [origin, setOrigin] = useState("http://localhost:4310");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setOrigin(window.location.origin);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const command = `claude mcp add --transport http --scope user whystack ${origin}/api/mcp`;

  return (
    <dialog ref={ref} className="mk-modal ws-pair" onClose={onClose}>
      <div className="mk-modal__body mk-stack mk-gap-5">
        <div className="mk-row mk-gap-3">
          <div className="mk-grow mk-stack mk-gap-1">
            <span className="mk-eyebrow">Pair with Claude</span>
            <h3>Plan together with Claude Code</h3>
          </div>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <label className={cx("ws-pair__toggle", enabled && "is-on")}>
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          <span className="mk-stack mk-gap-1">
            <strong>Share the plan you have open with Claude</strong>
            <span className="mk-hint">
              {enabled ? "Claude sees this plan and can change it. Switch plans and Claude follows." : "Off. Claude can still check stacks, but can't see or change your plans."}
            </span>
          </span>
        </label>

        <section className="mk-stack mk-gap-2">
          <p className="mk-label">1. Add WhyStack to Claude Code, once</p>
          <pre className="mk-code ws-pair__cmd">{command}</pre>
          <button type="button" className="mk-btn mk-btn--secondary mk-sm ws-self-start" onClick={async () => onToast((await copyText(command)) ? "Copied. Run it in a terminal." : command)}>
            Copy the command
          </button>
        </section>

        <section className="mk-stack mk-gap-2">
          <p className="mk-label">2. Ask Claude to use it</p>
          <ul className="ws-pair__examples">
            <li>&ldquo;Check my WhyStack plan and fix the warnings.&rdquo;</li>
            <li>&ldquo;My app should pull prices from other sites. Add web scraping to the plan and compare the options.&rdquo;</li>
            <li>&ldquo;What would this stack cost at 1,000 users?&rdquo;</li>
          </ul>
        </section>

        <p className="mk-hint">
          Claude asks WhyStack&apos;s rules instead of guessing. Its changes show on the canvas right away, with its reason in the Claude tab, and Undo reverses any of them. Projects exported for Claude
          Code run WhyStack&apos;s MCP server themselves, and their changes show up here too.
          {reachable === false ? " Right now this tab can't reach WhyStack's server." : ""}
        </p>
      </div>
    </dialog>
  );
}

/** What Claude did through WhyStack on the open plan, newest first. */
export function ClaudePanel({ activity, enabled, onOpenPairing }: { activity: ClaudeActivity[]; enabled: boolean; onOpenPairing: () => void }) {
  if (activity.length === 0) {
    return (
      <div className="ws-inspector ws-inspector--empty mk-stack mk-gap-3">
        <p className="mk-muted">
          {enabled
            ? "Paired. When Claude checks, compares or changes this plan through WhyStack, it shows up here with its reasons."
            : "Pair with Claude to plan together: Claude uses WhyStack's rules through MCP, and everything it does shows up here."}
        </p>
        {!enabled && (
          <button type="button" className="mk-btn mk-btn--secondary mk-sm ws-self-start" onClick={onOpenPairing}>
            Pair with Claude
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="ws-inspector">
      <div className="mk-stack mk-gap-2">
        <span className="mk-eyebrow">Claude on this plan</span>
        <p className="mk-hint">Everything Claude did through WhyStack&apos;s MCP server. Changes can be undone with Undo.</p>
      </div>
      <ol className="ws-activity">
        {[...activity].reverse().map((entry) => (
          <li key={entry.id} className={cx("ws-activity__item", entry.tool === "update_plan" && "is-change")}>
            <div className="mk-row mk-gap-2 mk-wrap">
              <strong>{TOOL_LABELS[entry.tool] ?? entry.tool}</strong>
              {entry.verdict && VERDICTS.has(entry.verdict) && <VerdictBadge level={entry.verdict as Verdict} short />}
              <span className="mk-hint ws-activity__time">{timeLabel(entry.at)}</span>
            </div>
            <p>{entry.summary}</p>
            {entry.changes.length > 0 && (
              <ul>
                {entry.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
