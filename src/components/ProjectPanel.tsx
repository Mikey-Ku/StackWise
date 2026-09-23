"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { planEnv, type SlotId } from "@/engine";
import { agentName, pairInstructions, presence } from "@/mcp/pairing";
import { Icon } from "./icons";
import type { Pairing } from "./usePairing";
import type { PlanModel } from "./usePlans";
import { Logo, copyText, cx, imageToIcon } from "./ui";

/**
 * The plan's project folder, live: run the app and watch its log, set environment variables
 * without opening a file, check every service with the project's own keys, and read the database.
 * Everything goes through /api/project, which only this computer can call. Values go from this
 * page into the project's .env.local and never come back: the page only ever sees names, whether
 * each is set, and masked requests.
 */

interface Inspection {
  folder: string;
  exists: boolean;
  framework: string | null;
  label: string;
  commands: { label: string; command: string }[];
  healthUrl: string | null;
  env: { name: string; set: boolean; files: string[] }[];
  configRefs: string[];
  envIgnored: boolean;
  issues: string[];
  probes: string[];
  javaVersion?: string;
  icon: string | null;
}

interface RunInfo {
  id: string;
  command: string;
  running: boolean;
  exitCode: number | null;
  startedAt: string;
}

interface ProbeResult {
  id: string;
  title: string;
  ok: boolean;
  status?: number;
  ms?: number;
  request?: { url: string; headers: Record<string, string> };
  body?: string;
  missing?: string[];
  error?: string;
  statusPage?: string;
  sample?: { sends: unknown; gets: unknown };
}

type SqlResult = { columns: string[]; rows: unknown[][]; truncated: boolean; ms: number; database: string } | { error: string };

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok && json.error) throw new Error(json.error);
  return json;
}

function Section({ title, icon, children, right }: { title: string; icon: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="ws-proj__sec">
      <div className="ws-proj__head">
        <span className="mk-eyebrow">
          <Icon name={icon} size={13} /> {title}
        </span>
        {right}
      </div>
      {children}
    </section>
  );
}

/** The app's own logo: found in the project, or chosen by the person. Kept with the plan in this browser. */
function AppLogo({ model, path, found, onToast }: { model: PlanModel; path: string; found: string | null; onToast: (message: string) => void }) {
  const { plan, dispatch } = model;
  const input = useRef<HTMLInputElement>(null);
  const fromProject = async () => {
    try {
      const { data } = await call<{ data: string }>({ action: "icon", path });
      dispatch({ type: "setIcon", icon: data });
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't read the project's icon.");
    }
  };
  // A project with its own icon gets it the first time it's linked, unless a logo was chosen already.
  useEffect(() => {
    if (!found || plan.icon) return;
    const timer = window.setTimeout(() => void fromProject(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per project icon
  }, [found]);
  return (
    <div className="ws-proj__logo">
      <button type="button" className="ws-proj__logobtn" onClick={() => input.current?.click()} title="Choose a logo for this app">
        {plan.icon ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small data URL the person chose
          <img src={plan.icon} alt="" />
        ) : (
          <Icon name="plus" size={16} />
        )}
      </button>
      <span className="ws-proj__logotext">
        <strong>{plan.appName.trim() || "Your app"}</strong>
        <span>
          {plan.icon ? "Logo shown on the canvas. " : found ? "" : "No icon found in the project. "}
          <button type="button" className="ws-link" onClick={() => input.current?.click()}>
            {plan.icon ? "Change" : "Add a logo"}
          </button>
          {found && (
            <>
              {" \u00b7 "}
              <button type="button" className="ws-link" onClick={() => void fromProject()}>
                Use {found.split("/").pop()}
              </button>
            </>
          )}
          {plan.icon && (
            <>
              {" \u00b7 "}
              <button type="button" className="ws-link" onClick={() => dispatch({ type: "setIcon", icon: null })}>
                Remove
              </button>
            </>
          )}
        </span>
      </span>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            dispatch({ type: "setIcon", icon: await imageToIcon(file) });
          } catch {
            onToast("That image couldn't be read.");
          }
        }}
      />
    </div>
  );
}

function Runner({ path, project, appOk, onChecked }: { path: string; project: Inspection; appOk: boolean | null; onChecked: () => void }) {
  const [command, setCommand] = useState(project.commands[0]?.command ?? "");
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const seen = useRef(0);
  const current = runs.find((r) => r.running) ?? runs[runs.length - 1];

  // While a run is open, ask for new log lines every second and a half.
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const body = await call<{ runs: RunInfo[]; log: { lines: string[]; total: number } | null }>({ action: "runs", path, logFor: current?.id, after: seen.current });
        if (stopped) return;
        setRuns(body.runs);
        if (body.log && body.log.lines.length) {
          seen.current = body.log.total;
          setLog((l) => [...l, ...body.log!.lines].slice(-600));
        }
      } catch {
        // The next tick tries again.
      }
      if (!stopped) timer = window.setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [path, current?.id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log.length]);

  const start = async () => {
    setBusy(true);
    seen.current = 0;
    setLog([]);
    try {
      const { run } = await call<{ run: RunInfo }>({ action: "start", path, command });
      setRuns((r) => [...r.filter((x) => x.id !== run.id), run]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Run"
      icon="terminal"
      right={
        <span className={cx("ws-proj__health", appOk === true && "is-ok", appOk === false && "is-bad")} title={project.healthUrl ?? undefined}>
          <span className={cx("ws-status-dot", appOk && "is-on")} aria-hidden />
          {appOk === null ? "Checking" : appOk ? "App is up" : "App is down"}
          <button type="button" className="ws-link" onClick={onChecked}>
            Check
          </button>
        </span>
      }
    >
      <div className="ws-proj__runrow">
        <input className="mk-input mk-sm ws-proj__cmd" list="ws-proj-commands" value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} aria-label="Command to run" />
        <datalist id="ws-proj-commands">
          {project.commands.map((c) => (
            <option key={c.command} value={c.command}>
              {c.label}
            </option>
          ))}
        </datalist>
        {current?.running ? (
          <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => void call({ action: "stop", path, id: current.id })}>
            Stop
          </button>
        ) : (
          <button type="button" className="mk-btn mk-btn--primary mk-sm" disabled={busy || !command.trim()} onClick={() => void start()}>
            Start
          </button>
        )}
      </div>
      {project.commands.length > 1 && (
        <div className="ws-chips">
          {project.commands.map((c) => (
            <button key={c.command} type="button" className={cx("ws-chip", c.command === command && "is-on")} onClick={() => setCommand(c.command)} title={c.command}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {current && (
        <p className="mk-hint">
          {current.running ? `Running since ${new Date(current.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : `Stopped${current.exitCode === null ? "" : `, exit code ${current.exitCode}`}`}. Runs with a clean environment: StackWise&apos;s own keys never reach your app.
        </p>
      )}
      {log.length > 0 && (
        <pre className="ws-proj__log nowheel" ref={logRef}>
          {log.join("\n")}
        </pre>
      )}
    </Section>
  );
}

function EnvRow({ name, service, set, browser, planned, onSave }: { name: string; service?: string; set: boolean; browser: boolean; planned: boolean; onSave: (value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  return (
    <li className={cx("ws-proj__env", !set && "is-missing")}>
      <div className="ws-proj__envtop">
        <code>{name}</code>
        <span className={cx("ws-proj__tag", set ? "is-ok" : "is-bad")}>{set ? "Set" : "Missing"}</span>
        {browser && <span className="ws-proj__tag is-warn">Browser can read</span>}
        {!planned && <span className="ws-proj__tag">Not in the plan</span>}
        <button type="button" className="ws-link ws-proj__edit" onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel" : set ? "Change" : "Set"}
        </button>
      </div>
      {service && <span className="mk-hint">{service}</span>}
      {editing && (
        <form
          className="ws-proj__envform"
          onSubmit={async (e) => {
            e.preventDefault();
            await onSave(value);
            setValue("");
            setEditing(false);
          }}
        >
          <input className="mk-input mk-sm" type={shown ? "text" : "password"} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste the value" autoComplete="off" spellCheck={false} aria-label={`Value for ${name}`} autoFocus />
          <button type="button" className="ws-link" onClick={() => setShown((v) => !v)}>
            {shown ? "Hide" : "Show"}
          </button>
          <button type="submit" className="mk-btn mk-btn--primary mk-sm">
            Save
          </button>
        </form>
      )}
    </li>
  );
}

function ProbeRow({ result, logo, name }: { result: ProbeResult; logo: React.ReactNode; name: string }) {
  return (
    <details className={cx("ws-proj__probe", result.ok ? "is-ok" : "is-bad")}>
      <summary>
        {logo}
        <span className="ws-proj__probetext">
          <strong>{name}</strong>
          <span>{result.ok ? result.title : (result.error ?? `Answered ${result.status}`)}</span>
        </span>
        <span className={cx("ws-sig", result.ok ? "ws-sig--works" : "ws-sig--blocked")} aria-label={result.ok ? "Works" : "Failed"}>
          {result.ok ? "✓" : "×"}
        </span>
        {result.status !== undefined && (
          <span className="ws-proj__code">
            {result.status} &middot; {result.ms} ms
          </span>
        )}
      </summary>
      <div className="ws-proj__probebody">
        {result.request && (
          <>
            <span className="mk-eyebrow">Request (keys masked)</span>
            <pre>{`GET ${result.request.url}${Object.entries(result.request.headers)
              .map(([k, v]) => `\n${k}: ${v}`)
              .join("")}`}</pre>
          </>
        )}
        {result.body && (
          <>
            <span className="mk-eyebrow">What came back</span>
            <pre className="nowheel">{result.body}</pre>
          </>
        )}
        {result.sample && (
          <>
            <span className="mk-eyebrow">What travels on this connection (example)</span>
            <div className="ws-proj__sample">
              <div>
                <span className="mk-hint">Your app sends</span>
                <pre>{JSON.stringify(result.sample.sends, null, 2)}</pre>
              </div>
              <div>
                <span className="mk-hint">It gets back</span>
                <pre>{JSON.stringify(result.sample.gets, null, 2)}</pre>
              </div>
            </div>
          </>
        )}
        {result.statusPage && (
          <a href={result.statusPage} target="_blank" rel="noreferrer" className="ws-small-link">
            Is it them? Check their status page
          </a>
        )}
      </div>
    </details>
  );
}

interface GitWorktree {
  path: string;
  branch: string | null;
  main: boolean;
  agent: string | null;
  changes: { uncommitted: string[]; ahead: number; committed: string[] } | null;
}

interface GitInfo {
  repo: boolean;
  branch: string | null;
  clean: boolean;
  worktrees: GitWorktree[];
}

const AGENT_KINDS = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "gemini-cli", label: "Gemini CLI" },
];

/**
 * More than one agent at once: each gets its own copy of the repo (a git worktree beside it, on
 * its own branch), listens for its own messages, and gets merged back when the person says so.
 */
function Agents({ path, pairing, onToast }: { path: string; pairing: Pairing; onToast: (message: string) => void }) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [kind, setKind] = useState("codex");
  const [suffix, setSuffix] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await call<GitInfo>({ action: "git", path }));
    } catch {
      setInfo({ repo: false, branch: null, clean: false, worktrees: [] });
    }
  }, [path]);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      await load();
      if (!stopped) timer = window.setTimeout(tick, 5000);
    };
    timer = window.setTimeout(tick, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [load]);

  const act = async (body: Record<string, unknown>, done: (result: Record<string, unknown>) => string) => {
    setBusy(true);
    try {
      const result = await call<Record<string, unknown>>({ path, ...body });
      onToast(typeof result.error === "string" ? `${result.error}${Array.isArray(result.conflicts) && result.conflicts.length ? ` Clashing files: ${result.conflicts.join(", ")}.` : ""}` : done(result));
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (!info) return null;
  const agentId = suffix.trim() ? `${kind}-${suffix.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : kind;
  const copies = info.worktrees.filter((w) => !w.main && w.agent);

  return (
    <Section title="Agents" icon="terminal" right={<span className="mk-hint">Each works in its own copy</span>}>
      {!info.repo ? (
        <p className="mk-hint">This folder isn&apos;t a git repository, so agents can&apos;t get their own copies. Run git init in it to use this.</p>
      ) : (
        <>
          <p className="mk-hint">
            Your copy is on <code>{info.branch ?? "a detached commit"}</code>
            {info.clean ? ", with nothing uncommitted." : ", with uncommitted changes. Commit them before merging an agent's work."}
          </p>
          {copies.map((w) => {
            const state = pairing.agents[w.agent!];
            const listening = state ? presence(state, pairing.serverNow) : "not-connected";
            const changed = w.changes ? [...new Set([...w.changes.committed, ...w.changes.uncommitted])] : [];
            const claude = w.agent!.startsWith("claude-code");
            const start = claude ? `cd ${w.path} && claude "/mcp__whystack__pair ${w.agent}"` : `cd ${w.path}`;
            return (
              <div key={w.path} className="ws-proj__agent">
                <div className="ws-proj__envtop">
                  <span className={cx("ws-status-dot", (listening === "listening" || listening === "working") && "is-on")} aria-hidden />
                  <strong>{agentName(w.agent!)}</strong>
                  <code className="ws-proj__branch">{w.branch}</code>
                  <span className="ws-proj__tag">{listening === "not-connected" ? "Not connected" : listening}</span>
                </div>
                <span className="mk-hint">
                  {w.path.replace(/^\/Users\/[^/]+/, "~")}. {w.changes?.ahead ?? 0} commit{w.changes?.ahead === 1 ? "" : "s"} ahead, {changed.length} file{changed.length === 1 ? "" : "s"} changed
                  {w.changes?.uncommitted.length ? `, ${w.changes.uncommitted.length} not committed yet` : ""}.
                </span>
                {changed.length > 0 && (
                  <details className="ws-proj__files">
                    <summary>Files</summary>
                    <ul>
                      {changed.map((f) => (
                        <li key={f}>
                          <code>{f}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mk-row mk-gap-2 mk-wrap mk-sm">
                  <button
                    type="button"
                    className="mk-btn mk-btn--secondary"
                    onClick={async () => {
                      const text = claude ? start : `${start}\n\n${pairInstructions(w.agent!)}`;
                      onToast((await copyText(text)) ? (claude ? "Copied. Paste it into a new terminal." : `Copied. Run the cd, start ${agentName(w.agent!)}, and paste the rest.`) : text);
                    }}
                  >
                    Copy start command
                  </button>
                  {confirm === w.path ? (
                    <button type="button" className="mk-btn mk-btn--primary" disabled={busy} onClick={() => void act({ action: "merge", branch: w.branch }, (r) => `Merged ${w.branch} into ${info.branch}. ${String(r.summary ?? "")}`)}>
                      Merge {w.changes?.ahead ?? 0} commit{w.changes?.ahead === 1 ? "" : "s"} into {info.branch}?
                    </button>
                  ) : (
                    <button type="button" className="mk-btn mk-btn--secondary" disabled={!w.changes?.ahead} onClick={() => setConfirm(w.path)} title={w.changes?.ahead ? undefined : "Nothing committed to merge yet"}>
                      Merge into {info.branch}
                    </button>
                  )}
                  <button type="button" className="ws-link" disabled={busy} onClick={() => void act({ action: "worktree-remove", worktree: w.path }, () => `Removed ${agentName(w.agent!)}'s copy. Its branch ${w.branch} is kept.`)}>
                    Remove copy
                  </button>
                </div>
              </div>
            );
          })}
          <form
            className="ws-proj__addagent"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "worktree-add", agent: agentId }, (r) => `Made a copy for ${agentName(agentId)} at ${String(r.path)}, on ${String(r.branch)}. Start the agent there and pair it.`);
            }}
          >
            <select className="mk-select mk-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Which agent">
              {AGENT_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <input className="mk-input mk-sm" value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="name (optional), like frontend" aria-label="Name for this agent" />
            <button type="submit" className="mk-btn mk-btn--primary mk-sm" disabled={busy}>
              Add
            </button>
          </form>
        </>
      )}
    </Section>
  );
}

function SqlConsole({ path }: { path: string }) {
  const [query, setQuery] = useState("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setResult(await call<SqlResult>({ action: "sql", path, query }));
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "The query failed." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Database" icon="overview" right={<span className="mk-hint">Read-only</span>}>
      <textarea
        className="mk-textarea ws-proj__sql"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        rows={3}
        aria-label="SQL query"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void run();
          }
        }}
      />
      <div className="mk-row mk-gap-2 mk-sm">
        <button type="button" className="mk-btn mk-btn--primary" disabled={busy} onClick={() => void run()}>
          {busy ? "Running..." : "Run query"}
        </button>
        <span className="mk-hint">Cmd+Enter. Only SELECT, WITH, SHOW and EXPLAIN run, inside a read-only transaction.</span>
      </div>
      {result && "error" in result && <p className="ws-proj__error">{result.error}</p>}
      {result && !("error" in result) && (
        <div className="ws-proj__table nowheel">
          <p className="mk-hint">
            {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
            {result.truncated ? " (first 200)" : ""} from {result.database} in {result.ms} ms
          </p>
          <table className="mk-table">
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell === null ? <span className="mk-faint">null</span> : typeof cell === "object" ? JSON.stringify(cell) : String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function ProjectPanel({ model, pairing, onToast }: { model: PlanModel; pairing: Pairing; onToast: (message: string) => void }) {
  const { plan, dispatch, index, rec, catalog } = model;
  const [draft, setDraft] = useState(plan.folder ?? "");
  const [project, setProject] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});
  const [checking, setChecking] = useState(false);
  const path = plan.folder;

  const load = useCallback(async (folder: string) => {
    try {
      const found = await call<Inspection>({ action: "inspect", path: folder });
      setProject(found);
      // Keep the full path, so a later `stackwise` in that folder finds this plan.
      if (found.folder !== folder) dispatch({ type: "setFolder", folder: found.folder });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that folder.");
    }
  }, [dispatch]);

  useEffect(() => {
    if (!path) return;
    const timer = window.setTimeout(() => void load(path), 0);
    return () => window.clearTimeout(timer);
  }, [path, load]);

  const env = useMemo(() => planEnv(index, rec.selection), [index, rec.selection]);
  // Every service in the plan that has a live check, plus the app itself.
  const checkable = useMemo(
    () => (Object.entries(rec.selection) as [SlotId, string | undefined][]).flatMap(([slot, id]) => (id && project?.probes.includes(id) ? [{ slot, id }] : [])),
    [rec.selection, project?.probes],
  );

  const check = useCallback(
    async (ids: string[]) => {
      if (!path || !ids.length) return;
      setChecking(true);
      try {
        const { results } = await call<{ results: ProbeResult[] }>({ action: "probe", path, ids, ...(project?.healthUrl ? { healthUrl: project.healthUrl } : {}) });
        setProbes((p) => ({ ...p, ...Object.fromEntries(results.map((r) => [r.id, r])) }));
      } finally {
        setChecking(false);
      }
    },
    [path, project?.healthUrl],
  );

  // The app's own health, every 10 seconds while the panel is open.
  useEffect(() => {
    if (!project?.healthUrl) return;
    const first = window.setTimeout(() => void check(["app"]), 0);
    const timer = window.setInterval(() => void check(["app"]), 10_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [project?.healthUrl, check]);

  if (!path || !project) {
    return (
      <div className="ws-proj">
        <p className="mk-muted">Link this plan to its project folder to run the app, set its environment variables, check every service with your own keys, and read its database. Everything stays on this computer.</p>
        <form
          className="ws-proj__link"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            dispatch({ type: "setFolder", folder: draft.trim() });
          }}
        >
          <input className="mk-input mk-sm" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="~/Projects/my-app" spellCheck={false} aria-label="Project folder" />
          <button type="submit" className="mk-btn mk-btn--primary mk-sm">
            Link
          </button>
        </form>
        {error && <p className="ws-proj__error">{error}</p>}
      </div>
    );
  }

  const planned = new Set(env.map((v) => v.name));
  const inProject = new Map(project.env.map((e) => [e.name, e]));
  const rows = [
    ...env.map((v) => ({ name: v.name, service: `${v.optionName}: ${v.step}`, set: inProject.get(v.name)?.set ?? false, browser: v.browser, planned: true })),
    ...project.env.filter((e) => !planned.has(e.name)).map((e) => ({ name: e.name, service: `In ${e.files.join(", ")}`, set: e.set, browser: false, planned: false })),
  ];
  const missing = rows.filter((r) => r.planned && !r.set).length;
  const frameworkMismatch = project.framework && rec.selection.framework && project.framework !== rec.selection.framework ? project.framework : null;
  const appResult = probes.app;

  return (
    <div className="ws-proj">
      <div className="ws-proj__top">
        <Icon name="pin" size={14} />
        <span className="ws-proj__folder" title={project.folder}>
          {project.folder.replace(/^\/Users\/[^/]+/, "~")}
        </span>
        <span className="ws-proj__tag">{project.label}</span>
        <button
          type="button"
          className="ws-link"
          onClick={() => {
            dispatch({ type: "setFolder", folder: null });
            setProject(null);
            setProbes({});
          }}
        >
          Unlink
        </button>
      </div>

      <AppLogo model={model} path={path} found={project.icon} onToast={onToast} />

      {(project.issues.length > 0 || frameworkMismatch || !project.exists) && (
        <ul className="ws-proj__issues">
          {!project.exists && <li>That folder doesn&apos;t exist.</li>}
          {frameworkMismatch && (
            <li>
              The folder looks like {index.optionsById.get(frameworkMismatch)?.name ?? frameworkMismatch}, but the plan says {index.optionsById.get(rec.selection.framework!)?.name}.{" "}
              {index.optionsById.has(frameworkMismatch) && (
                <button type="button" className="ws-link" onClick={() => model.place(frameworkMismatch, "framework")}>
                  Use {index.optionsById.get(frameworkMismatch)?.name}
                </button>
              )}
            </li>
          )}
          {project.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <Runner path={path} project={project} appOk={appResult ? appResult.ok : null} onChecked={() => void check(["app"])} />

      <Section title="Checks" icon="checklist" right={checkable.length > 0 && <button type="button" className="mk-btn mk-btn--secondary mk-sm" disabled={checking} onClick={() => void check(["app", ...checkable.map((c) => c.id)])}>{checking ? "Checking..." : "Check everything"}</button>}>
        {appResult && <ProbeRow result={appResult} name={plan.appName.trim() || "Your app"} logo={<Icon name="web" size={20} />} />}
        {checkable.map(({ id }) => {
          const option = index.optionsById.get(id);
          const result = probes[id];
          return result ? (
            <ProbeRow key={id} result={result} name={option?.name ?? id} logo={<Logo logo={catalog.logos[id]} name={option?.name ?? id} size={20} />} />
          ) : (
            <div key={id} className="ws-proj__probe is-idle">
              <Logo logo={catalog.logos[id]} name={option?.name ?? id} size={20} />
              <span className="ws-proj__probetext">
                <strong>{option?.name}</strong>
                <span>Not checked yet</span>
              </span>
              <button type="button" className="ws-link" onClick={() => void check([id])}>
                Check
              </button>
            </div>
          );
        })}
        {checkable.length === 0 && !appResult && <p className="mk-hint">None of the services in this plan has a live check yet.</p>}
      </Section>

      <Section title={`Environment${missing ? `, ${missing} missing` : ""}`} icon="note" right={<span className="mk-hint">Writes to .env.local</span>}>
        {!project.envIgnored && <p className="ws-proj__error">.env.local isn&apos;t in .gitignore. Add it before you set any keys, so they never get committed.</p>}
        <ul className="ws-proj__envs">
          {rows.map((row) => (
            <EnvRow
              key={row.name}
              {...row}
              onSave={async (value) => {
                try {
                  const body = await call<{ project: Inspection; created: boolean; ignored: boolean }>({ action: "env", path, name: row.name, value });
                  setProject(body.project);
                  onToast(`Saved ${row.name} to .env.local${body.created ? ", which StackWise just created" : ""}. Restart the app for it to take effect.`);
                } catch (e) {
                  onToast(e instanceof Error ? e.message : "Couldn't save it.");
                }
              }}
            />
          ))}
        </ul>
        {project.configRefs.length > 0 && <p className="mk-hint">The app&apos;s config also reads: {project.configRefs.join(", ")}.</p>}
      </Section>

      <Agents path={path} pairing={pairing} onToast={onToast} />

      <SqlConsole path={path} />
    </div>
  );
}
