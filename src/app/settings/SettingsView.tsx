"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnswererMark } from "@/components/AnswererMark";
import { providersOf, recipientsFor, saveDefaultAnswerer, saveProviderSetting, STATE_TEXT, type Recipient } from "@/components/answerers";
import { KeyForm } from "@/components/ConnectPanel";
import { Icon, type IconName } from "@/components/icons";
import type { AiStatus, ProviderInfo } from "@/components/Planner";
import { Shell, shortPath, useMe, type Me } from "@/components/Shell";
import { useTheme, type Theme } from "@/components/ThemeSwitch";
import { copyText, cx } from "@/components/ui";
import { FEATURED_AGENTS, pairInstructions } from "@/mcp/pairing";

/**
 * Settings, one section at a time, picked from a list on the left like System Settings:
 *   Account (who you are, where plans live), General (what a new plan starts with, folders),
 *   Appearance (theme), Models (who answers in Ask; a key and a model per built-in AI), and
 *   Agents (coding agents on this computer, connecting them to StackWise, the MCP server).
 * Everything is saved to ~/.stackwise or StackWise's own .env.local. The section is in the URL
 * hash, so a link can open straight to Models.
 */

type Section = "account" | "general" | "appearance" | "models" | "agents";

const SECTIONS: { id: Section; label: string; icon: IconName; blurb: string }[] = [
  { id: "account", label: "Account", icon: "pin", blurb: "Who you are, and where your plans live." },
  { id: "general", label: "General", icon: "tool", blurb: "What a new plan starts with, and the folders StackWise looks in for projects." },
  { id: "appearance", label: "Appearance", icon: "sun", blurb: "Light, dark, or whatever the system says." },
  { id: "models", label: "Models", icon: "sparkle", blurb: "Who answers in Ask. A built-in AI needs a key; pick its model here. It never decides what works: StackWise's rules do." },
  { id: "agents", label: "Agents", icon: "terminal", blurb: "Coding agents on this computer, connected to StackWise over MCP so they ask it instead of guessing." },
];

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
  /** For Claude Code: the model its new sessions start with, null for its own default. */
  model?: string | null;
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

function sectionFromHash(): Section {
  const hash = window.location.hash.slice(1);
  return SECTIONS.some((s) => s.id === hash) ? (hash as Section) : "account";
}
const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const serverSection = (): Section => "account";

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

/** The model a built-in AI answers with: one of the ones it offers, or any id typed in. */
function ModelPicker({ provider, onSaved, onToast }: { provider: ProviderInfo; onSaved: (ai: AiStatus) => void; onToast: (message: string) => void }) {
  const models = provider.models ?? [];
  const known = !provider.model || models.includes(provider.model);
  const [other, setOther] = useState(!known);
  const [custom, setCustom] = useState(known ? "" : provider.model);
  const [busy, setBusy] = useState(false);
  if (!provider.modelEnv) return null;
  const save = async (value: string) => {
    setBusy(true);
    try {
      onSaved(await saveProviderSetting(provider.modelEnv!, value));
      onToast(value ? `${provider.label} answers with ${value}.` : `${provider.label} is back on its default model.`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't save the model.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="set-field">
      <span className="mk-label">Model</span>
      <div className="set-model">
        <select
          className="mk-select mk-sm"
          aria-label={`${provider.label} model`}
          value={other ? "other" : provider.model || models[0] || ""}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === "other") {
              setOther(true);
              return;
            }
            setOther(false);
            void save(e.target.value === provider.defaultModel ? "" : e.target.value);
          }}
        >
          {models.map((m) => {
            const known = provider.modelInfo?.find((x) => x.id === m);
            return (
              <option key={m} value={m}>
                {known?.name ?? m}
                {m === provider.defaultModel ? " (default)" : ""}
                {known ? ` · ${known.context} context · ${known.price} per M tokens` : ""}
              </option>
            );
          })}
          <option value="other">Other...</option>
        </select>
        {other && (
          <form
            className="set-addrow"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) void save(custom.trim());
            }}
          >
            <input className="mk-input mk-sm" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="model id" spellCheck={false} aria-label="Model id" />
            <button type="submit" className="mk-btn mk-btn--secondary mk-sm" disabled={busy || !custom.trim()}>
              Use
            </button>
          </form>
        )}
      </div>
      <span className="mk-hint">
        {provider.modelInfo?.find((x) => x.id === (provider.model || provider.defaultModel))?.note ?? ""} Prices are input / output per million tokens, from the provider&apos;s own page. Saved as <code>{provider.modelEnv}</code> in StackWise&apos;s .env.local.
      </span>
    </div>
  );
}

export default function SettingsView({ builders, priorities, sizes }: { builders: Choice[]; priorities: Choice[]; sizes: Choice[] }) {
  const [me, setMe] = useMe();
  // The section lives in the URL hash, so /settings#models opens straight to Models.
  const section = useSyncExternalStore(subscribeToHash, sectionFromHash, serverSection);
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

  const show = (id: Section) => {
    window.history.replaceState(null, "", `#${id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

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

  /** The model Claude Code starts new sessions with, written to its own settings file. */
  const setAgentModel = async (model: string) => {
    setBusy("model");
    try {
      const r = await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "model", agent: "claude-code", model }) });
      const body = (await r.json()) as { agents?: Agent[]; error?: string };
      if (!r.ok || !body.agents) throw new Error(body.error ?? "That didn't work.");
      setAgents(body.agents);
      setToast(model ? "New Claude Code sessions start with that model. A session already open switches with /model." : "Claude Code is back on its own default model.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };
  const claudeModels = providersOf(ai).find((p) => p.id === "claude");

  // No agent presence here: Settings only lists them, so the clock doesn't matter.
  const recipients = recipientsFor(ai, { agents: {}, serverNow: 0 });
  const apis = recipients.filter((r) => r.group === "api");
  const featured = (agents ?? []).filter((a) => FEATURED_AGENTS.includes(a.id) || a.installed);
  const more = (agents ?? []).filter((a) => !featured.includes(a));
  const answerers: Recipient[] = [...recipients.filter((r) => r.group === "agent" && agents?.find((a) => a.id === r.id.slice("agent:".length))?.installed), ...apis.filter((r) => r.state === "ready"), recipients.find((r) => r.id === "facts")!];
  const initial = (profile?.name.trim() || me?.account || "?").charAt(0).toUpperCase();
  const current = SECTIONS.find((s) => s.id === section)!;

  const agentCard = (a: Agent) => (
    <Card key={a.id} logo={<AnswererMark id={`agent:${a.id}`} />} title={a.name} sub={a.maker} state={a.installed ? (a.mcp?.connected ? "Connected" : "Installed") : "Not installed"} on={a.installed}>
      {a.installed ? (
        <dl className="set-rows">
          <dt>Location</dt>
          <dd>
            <code>{shortPath(a.path ?? "", me?.home)}</code>
          </dd>
          {a.version && (
            <>
              <dt>Version</dt>
              <dd>
                <code>{a.version}</code>
              </dd>
            </>
          )}
          <dt>StackWise</dt>
          <dd>
            {a.mcp ? (
              a.mcp.connected ? (
                <span className="set-state is-on">
                  <span className="ws-status-dot is-on" aria-hidden /> Connected over MCP
                </span>
              ) : a.mcp.url ? (
                `Pointed at ${a.mcp.url}, which won't work. Connect it again.`
              ) : (
                "Not connected yet."
              )
            ) : (
              "Add StackWise as an HTTP MCP server named stackwise, then paste the pair instructions."
            )}
          </dd>
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
      {a.installed && a.id === "claude-code" && claudeModels && (
        <label className="set-field">
          <span className="mk-label">Model for new sessions</span>
          <select
            className="mk-select mk-sm"
            value={a.model && claudeModels.models?.includes(a.model) ? a.model : a.model ? "other" : ""}
            disabled={busy !== null}
            onChange={(e) => {
              if (e.target.value !== "other") void setAgentModel(e.target.value);
            }}
          >
            <option value="">Claude Code&apos;s own default</option>
            {a.model && !claudeModels.models?.includes(a.model) && <option value="other">As Claude Code has it: {a.model}</option>}
            {(claudeModels.models ?? []).map((m) => {
              const known = claudeModels.modelInfo?.find((x) => x.id === m);
              return (
                <option key={m} value={m}>
                  {known?.name ?? m}
                  {known ? ` · ${known.context} context · ${known.price} per M tokens` : ""}
                </option>
              );
            })}
          </select>
          <span className="mk-hint">
            Written to <code>~/.claude/settings.json</code> as <code>model</code>. A session that&apos;s already open switches with <code>/model</code>.
          </span>
        </label>
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

      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={cx("set-nav__item", section === s.id && "is-on")} aria-current={section === s.id ? "page" : undefined} onClick={() => show(s.id)}>
              <Icon name={s.icon} size={16} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>

        <div className="set-pane" key={section}>
          <div className="set-pane__head">
            <h2 className="shell-h2">{current.label}</h2>
            <p className="mk-muted">{current.blurb}</p>
          </div>

          {section === "account" && (
            <>
              <div className="set-card">
                <div className="set-me">
                  <span className="shell-avatar" aria-hidden>
                    {initial}
                  </span>
                  <div className="mk-stack mk-gap-1">
                    <strong>{profile?.name.trim() || me?.account || "You"}</strong>
                    <span className="mk-hint">Signed in to this Mac as {me?.account ?? "..."}. StackWise has no accounts of its own.</span>
                  </div>
                </div>
                <label className="set-field">
                  <span className="mk-label">Your name</span>
                  <input
                    className="mk-input mk-sm"
                    key={profile?.name ?? ""}
                    defaultValue={profile?.name ?? ""}
                    placeholder={me?.account ?? "Your name"}
                    onBlur={(e) => e.target.value !== (profile?.name ?? "") && void save({ name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <span className="mk-hint">How the Projects page greets you.</span>
                </label>
              </div>
              <div className="set-group">
                <h3>Storage</h3>
                <div className="set-card">
                  <dl className="set-rows">
                    <dt>Plans and profile</dt>
                    <dd>
                      <code>{me ? shortPath(me.dir, me.home) : "~/.stackwise"}</code>
                    </dd>
                    <dt>AI keys</dt>
                    <dd>
                      <code>{ai?.desktop ? `${me ? shortPath(me.dir, me.home) : "~/.stackwise"}/.env.local` : ".env.local in StackWise's folder"}</code>
                    </dd>
                  </dl>
                  <p className="set-note">One JSON file per plan, readable by any agent you pair. Delete a plan on the Projects page to remove its file.</p>
                </div>
              </div>
            </>
          )}

          {section === "general" && (
            <>
              <div className="set-group">
                <h3>A new plan starts with</h3>
                <div className="set-card">
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
                  </div>
                </div>
              </div>
              <div className="set-group">
                <h3>Folders</h3>
                <div className="set-card">
                  <p className="set-note">Where your projects live. StackWise lists what it finds one level under each, on the Projects page.</p>
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
              </div>
            </>
          )}

          {section === "appearance" && (
            <div className="set-card">
              <div className="set-field">
                <span className="mk-label">Theme</span>
                <div className="set-seg" role="radiogroup" aria-label="Theme">
                  {(
                    [
                      ["system", "System"],
                      ["light", "Light"],
                      ["dark", "Dark"],
                    ] as [Theme, string][]
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={theme === id}
                      className={cx(theme === id && "is-on")}
                      onClick={() => {
                        setTheme(id);
                        void save({ theme: id });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="mk-hint">The canvas, the pages and the Mac app follow it.</span>
              </div>
            </div>
          )}

          {section === "models" && (
            <>
              <div className="set-card">
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
                  <span className="mk-hint">A coding agent in your terminal, a built-in AI below, or StackWise&apos;s facts with no AI at all. You can switch per message in Ask.</span>
                </label>
              </div>
              <div className="set-group">
                <h3>Built-in AI</h3>
                <div className="set-stack">
                  {apis.map((r) => {
                    const provider = providersOf(ai).find((p) => `api:${p.id}` === r.id);
                    return (
                      <Card key={r.id} logo={<AnswererMark id={r.id} />} title={r.label.replace(/ \(.*\)$/, "").replace(/ API$/, "")} sub={provider?.on ? provider.model : undefined} state={r.state === "ready" ? "Ready" : STATE_TEXT[r.state]} on={r.state === "ready"}>
                        {provider && provider.id !== "ollama" && (provider.models?.length ?? 0) > 0 && <ModelPicker key={`${provider.id}-${provider.model}`} provider={provider} onSaved={setAi} onToast={setToast} />}
                        {r.keyName && provider?.id !== "ollama" && (
                          <div className="set-field">
                            <span className="mk-label">Authentication</span>
                            <KeyForm key={r.id} recipient={r} keyName={r.keyName} onSaved={setAi} onToast={setToast} />
                          </div>
                        )}
                        {provider?.id === "ollama" && (
                          <p className="set-note">
                            Runs on this computer, no key. Set <code>OLLAMA_MODEL</code> in StackWise&apos;s .env.local to the model you pulled, then restart StackWise.
                          </p>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {section === "agents" && (
            <>
              <div className="set-group">
                <h3>In this app</h3>
                <Card logo={<AnswererMark id="facts" />} title="StackWise facts" sub="No account, no key" state="Ready" on>
                  <p className="set-note">Every verdict, cost, setup step and build task comes from StackWise&apos;s rules over sourced facts. The agents below ask it over MCP; a built-in AI (Models) only explains what it computed.</p>
                </Card>
              </div>
              <div className="set-group">
                <h3>Coding agents</h3>
                {agents === null ? (
                  <p className="mk-hint">Looking...</p>
                ) : (
                  <>
                    <div className="set-stack">{featured.map(agentCard)}</div>
                    {more.length > 0 && (
                      <details className="set-more">
                        <summary>More agents ({more.length})</summary>
                        <div className="set-stack">{more.map(agentCard)}</div>
                      </details>
                    )}
                  </>
                )}
              </div>
              <div className="set-group">
                <h3>MCP server</h3>
                <Card logo={<AnswererMark id="facts" />} title="StackWise MCP server" sub="Streamable HTTP, stateless, 15 tools" state={ai ? "Running" : "Checking"} on={Boolean(ai)}>
                  <div className="set-cmd">
                    <code>{mcpUrl}</code>
                    <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={async () => setToast((await copyText(mcpUrl)) ? "Copied." : mcpUrl)}>
                      Copy
                    </button>
                  </div>
                  <p className="set-note">
                    It answers this computer only, while StackWise is open. Claude Code: press Connect above. Other agents: add it as an HTTP MCP server named <code>stackwise</code>. Every tool is described in{" "}
                    <a href="https://github.com/Mikey-Ku/StackWise/blob/main/docs/MCP.md" target="_blank" rel="noreferrer">
                      docs/MCP.md
                    </a>
                    .
                  </p>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="ws-toast" role="status">
          {toast}
        </div>
      )}
    </Shell>
  );
}
