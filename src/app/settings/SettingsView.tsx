"use client";

import { useEffect, useState } from "react";
import { AnswererMark } from "@/components/AnswererMark";
import { providersOf, recipientsFor, saveDefaultAnswerer, STATE_TEXT, type Recipient } from "@/components/answerers";
import { KeyForm } from "@/components/ConnectPanel";
import { Icon } from "@/components/icons";
import type { AiStatus } from "@/components/Planner";
import { Shell, shortPath, useMe, type Me } from "@/components/Shell";
import { useTheme } from "@/components/ThemeSwitch";
import { copyText, cx } from "@/components/ui";
import { FEATURED_AGENTS, pairInstructions } from "@/mcp/pairing";

/**
 * Settings: who you are and the defaults for a new plan, the folders StackWise looks in, the
 * coding agents on this computer (and connecting Claude Code to StackWise), the AI keys, and
 * the MCP server's address. Everything is saved to ~/.stackwise or StackWise's own .env.local.
 */

interface Agent {
  id: string;
  name: string;
  maker: string;
  command: string;
  installed: boolean;
  path?: string;
  version?: string;
  site: string;
  mcp?: { connected: boolean; url: string | null };
}
interface Choice {
  id: string;
  label: string;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function Card({ logo, title, sub, state, on, children }: { logo: React.ReactNode; title: string; sub?: string; state?: string; on?: boolean; children?: React.ReactNode }) {
  return (
    <div className="set-card">
      <div className="set-card__head">
        <span className="set-card__logo" aria-hidden>
          {logo}
        </span>
        <span className="set-card__title">
          <strong>{title}</strong>
          {sub && <span>{sub}</span>}
        </span>
        {state && (
          <span className={cx("set-state", on && "is-on")}>
            <span className={cx("ws-status-dot", on && "is-on")} aria-hidden />
            {state}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export default function SettingsView({ builders, priorities, sizes }: { builders: Choice[]; priorities: Choice[]; sizes: Choice[] }) {
  const [me, setMe] = useMe();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [mcpUrl, setMcpUrl] = useState("http://127.0.0.1:4310/api/mcp");
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [folder, setFolder] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    void getJson<{ agents: Agent[]; mcpUrl: string }>("/api/agents").then((body) => {
      if (body) {
        setAgents(body.agents);
        setMcpUrl(body.mcpUrl);
      }
    });
    void getJson<AiStatus>("/api/status").then((body) => body && setAi(body));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const profile = me?.profile;
  /** One change to the profile, saved at once. */
  const save = async (patch: Partial<Me["profile"]>) => {
    if (!me) return;
    const optimistic = { ...me, profile: { ...me.profile, ...patch } };
    setMe(optimistic);
    try {
      const r = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const body = (await r.json()) as { profile?: Me["profile"]; error?: string };
      if (!r.ok || !body.profile) throw new Error(body.error ?? "Couldn't save.");
      setMe({ ...me, profile: body.profile });
    } catch (e) {
      setMe(me);
      setToast(e instanceof Error ? e.message : "Couldn't save.");
    }
  };

  const connect = async (action: "connect" | "disconnect") => {
    setBusy(action);
    try {
      const r = await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, agent: "claude-code" }) });
      const body = (await r.json()) as { agents?: Agent[]; error?: string };
      if (!r.ok || !body.agents) throw new Error(body.error ?? "That didn't work.");
      setAgents(body.agents);
      setToast(action === "connect" ? "Claude Code can reach StackWise. In any project: claude, then /mcp__stackwise__pair" : "Removed StackWise from Claude Code.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  // No agent presence here: Settings only lists them, so the clock doesn't matter.
  const recipients = recipientsFor(ai, { agents: {}, serverNow: 0 });
  const apis = recipients.filter((r) => r.group === "api");
  const featured = (agents ?? []).filter((a) => FEATURED_AGENTS.includes(a.id) || a.installed);
  const more = (agents ?? []).filter((a) => !featured.includes(a));
  const answerers: Recipient[] = [...recipients.filter((r) => r.group === "agent" && agents?.find((a) => a.id === r.id.slice("agent:".length))?.installed), ...apis.filter((r) => r.state === "ready"), recipients.find((r) => r.id === "facts")!];

  const agentCard = (a: Agent) => (
    <Card key={a.id} logo={<AnswererMark id={`agent:${a.id}`} />} title={a.name} sub={a.maker} state={a.installed ? (a.version ? `Installed, ${a.version}` : "Installed") : "Not installed"} on={a.installed}>
      {a.installed ? (
        <dl className="set-rows">
          <dt>Location</dt>
          <dd>
            <code>{shortPath(a.path ?? "", me?.home)}</code>
          </dd>
          {a.mcp && (
            <>
              <dt>StackWise</dt>
              <dd>
                {a.mcp.connected ? (
                  <span className="set-state is-on">
                    <span className="ws-status-dot is-on" aria-hidden /> Connected over MCP
                  </span>
                ) : a.mcp.url ? (
                  `Pointed at ${a.mcp.url}, which won't work. Connect it again.`
                ) : (
                  "Not connected yet."
                )}
              </dd>
            </>
          )}
        </dl>
      ) : (
        <p className="set-note">
          Get it at{" "}
          <a href={a.site} target="_blank" rel="noreferrer">
            {a.site.replace(/^https?:\/\//, "")}
          </a>
          , then come back here.
        </p>
      )}
      {a.installed && a.mcp && (
        <div className="shell-actions">
          {a.mcp.connected ? (
            <button type="button" className="mk-btn mk-btn--ghost mk-sm" disabled={busy !== null} onClick={() => void connect("disconnect")}>
              Disconnect
            </button>
          ) : (
            <button type="button" className="mk-btn mk-btn--primary mk-sm" disabled={busy !== null} onClick={() => void connect("connect")}>
              {busy === "connect" ? "Connecting" : "Connect to StackWise"}
            </button>
          )}
          <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={async () => setToast((await copyText("/mcp__stackwise__pair")) ? "Copied. Run it inside Claude Code, in your project." : "/mcp__stackwise__pair")}>
            Copy the pair command
          </button>
        </div>
      )}
      {a.installed && !a.mcp && (
        <div className="shell-actions">
          <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={async () => setToast((await copyText(mcpUrl)) ? `Copied. Add it to ${a.name} as an HTTP MCP server named stackwise.` : mcpUrl)}>
            Copy the MCP address
          </button>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={async () => setToast((await copyText(pairInstructions(a.id))) ? `Copied. Paste it into ${a.name} once it has the address.` : "Couldn't copy.")}>
            Copy the pair instructions
          </button>
        </div>
      )}
    </Card>
  );

  return (
    <Shell me={me}>
      <div className="shell-head">
        <div className="mk-stack mk-gap-1">
          <h1 className="shell-title">Settings</h1>
          <p className="mk-muted">Saved in {me ? shortPath(me.dir, me.home) : "~/.stackwise"} on this computer.</p>
        </div>
      </div>

      <section className="shell-section">
        <h2 className="shell-h2">Profile</h2>
        <div className="set-card">
          <div className="set-grid">
            <label className="set-field">
              <span className="mk-label">Your name</span>
              <input className="mk-input mk-sm" value={profile?.name ?? ""} placeholder={me?.account || "Your name"} onChange={(e) => me && setMe({ ...me, profile: { ...me.profile, name: e.target.value } })} onBlur={(e) => void save({ name: e.target.value })} />
            </label>
            <label className="set-field">
              <span className="mk-label">Theme</span>
              <select className="mk-select mk-sm" value={theme} onChange={(e) => (setTheme(e.target.value as "system" | "light" | "dark"), void save({ theme: e.target.value as "system" | "light" | "dark" }))}>
                <option value="system">Follow the system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
          <span className="mk-eyebrow">A new plan starts with</span>
          <div className="set-grid">
            <label className="set-field">
              <span className="mk-label">Builder</span>
              <select className="mk-select mk-sm" value={profile?.builderId ?? "claude-code"} onChange={(e) => void save({ builderId: e.target.value })}>
                {builders.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="set-field">
              <span className="mk-label">Priority</span>
              <select className="mk-select mk-sm" value={profile?.priority ?? "spend_zero"} onChange={(e) => void save({ priority: e.target.value as Me["profile"]["priority"] })}>
                {priorities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="set-field">
              <span className="mk-label">Audience size</span>
              <select className="mk-select mk-sm" value={profile?.size ?? "up_to_100"} onChange={(e) => void save({ size: e.target.value as Me["profile"]["size"] })}>
                {sizes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="set-field">
              <span className="mk-label">Who answers in Ask</span>
              <select
                className="mk-select mk-sm"
                value={profile?.answerer || "facts"}
                onChange={(e) => {
                  saveDefaultAnswerer(e.target.value);
                  void save({ answerer: e.target.value });
                }}
              >
                {answerers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.group === "api" ? r.label.replace(/ \(.*\)$/, "") : r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="shell-section">
        <div className="mk-stack mk-gap-1">
          <h2 className="shell-h2">Folders</h2>
          <p className="mk-muted">Where your projects live. StackWise lists what it finds one level under each, on the Projects page.</p>
        </div>
        <div className="set-card">
          <ul className="set-list">
            {(profile?.folders ?? []).map((f) => (
              <li key={f}>
                <Icon name="pin" size={14} />
                <code>{f}</code>
                <button type="button" className="ws-link" onClick={() => void save({ folders: (profile?.folders ?? []).filter((x) => x !== f) })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <form
            className="set-addrow"
            onSubmit={(e) => {
              e.preventDefault();
              const next = folder.trim();
              if (!next || profile?.folders.includes(next)) return;
              void save({ folders: [...(profile?.folders ?? []), next] });
              setFolder("");
            }}
          >
            <input className="mk-input mk-sm" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="~/code" spellCheck={false} aria-label="A folder to look in" />
            <button type="submit" className="mk-btn mk-btn--secondary mk-sm" disabled={!folder.trim()}>
              Add folder
            </button>
          </form>
        </div>
      </section>

      <section className="shell-section">
        <div className="mk-stack mk-gap-1">
          <h2 className="shell-h2">Coding agents</h2>
          <p className="mk-muted">Agents on this computer that can build from your plan. Connected over MCP, they ask StackWise instead of guessing.</p>
        </div>
        {agents === null ? (
          <p className="mk-hint">Looking...</p>
        ) : (
          <>
            <div className="set-grid">{featured.map(agentCard)}</div>
            {more.length > 0 && (
              <details className="set-more">
                <summary>More agents ({more.length})</summary>
                <div className="set-grid">{more.map(agentCard)}</div>
              </details>
            )}
          </>
        )}
      </section>

      <section className="shell-section">
        <div className="mk-stack mk-gap-1">
          <h2 className="shell-h2">AI with a key</h2>
          <p className="mk-muted">Reads your description, explains plans and answers questions. It never decides what works: StackWise&apos;s rules do. Keys stay in StackWise&apos;s own .env.local.</p>
        </div>
        <div className="set-grid">
          {apis.map((r) => {
            const provider = providersOf(ai).find((p) => `api:${p.id}` === r.id);
            return (
              <Card key={r.id} logo={<AnswererMark id={r.id} />} title={r.label.replace(/ \(.*\)$/, "").replace(/ API$/, "")} sub={provider?.on ? provider.model : undefined} state={r.state === "ready" ? "Ready" : STATE_TEXT[r.state]} on={r.state === "ready"}>
                {r.keyName && provider?.id !== "ollama" && <KeyForm key={r.id} recipient={r} keyName={r.keyName} onSaved={setAi} onToast={setToast} />}
                {provider?.id === "ollama" && !provider.on && (
                  <p className="set-note">
                    Runs on this computer. Set <code>OLLAMA_MODEL</code> in StackWise&apos;s .env.local to the model you pulled, then restart StackWise.
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <section className="shell-section">
        <div className="mk-stack mk-gap-1">
          <h2 className="shell-h2">MCP server</h2>
          <p className="mk-muted">StackWise&apos;s 14 tools, for any agent that speaks MCP. It answers this computer only, while StackWise is running.</p>
        </div>
        <Card logo={<AnswererMark id="facts" />} title="StackWise MCP server" sub="Streamable HTTP, stateless" state={ai ? "Running" : "Checking"} on={Boolean(ai)}>
          <div className="set-cmd">
            <code>{mcpUrl}</code>
            <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={async () => setToast((await copyText(mcpUrl)) ? "Copied." : mcpUrl)}>
              Copy
            </button>
          </div>
          <p className="set-note">
            Claude Code: press Connect above, or run <code>claude mcp add --transport http --scope user stackwise {mcpUrl}</code>. Other agents: add it as an HTTP MCP server named <code>stackwise</code>. The tools are listed in the documentation.
          </p>
        </Card>
      </section>

      {toast && (
        <div className="ws-toast" role="status">
          {toast}
        </div>
      )}
    </Shell>
  );
}
