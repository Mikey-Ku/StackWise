"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEMOS } from "@/components/demos";
import { Icon } from "@/components/icons";
import { readPlanFile } from "@/components/planFiles";
import { deletePlanOnDisk, loadHistory, newId, planDefaults, pullLibrary, saveStore } from "@/components/savedStore";
import { Shell, shortPath, useMe } from "@/components/Shell";
import { migrateLegacyStorage } from "@/components/storage";
import { reduce, type History, type PlanState, type StoreAction } from "@/components/store";

// Saved data from before StackWise's rename moves to its new keys before anything reads it.
if (typeof window !== "undefined") migrateLegacyStorage();

const updated = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? `today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

function AppIcon({ plan, found }: { plan: Pick<PlanState, "appName" | "icon">; found?: boolean }) {
  return (
    <span className="apps-icon" aria-hidden>
      {plan.icon ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small data URL the person chose
        <img src={plan.icon} alt="" />
      ) : found ? (
        <Icon name="pin" size={16} />
      ) : (
        (plan.appName.trim() || "U").slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

interface Found {
  path: string;
  short: string;
  name: string;
  framework: string | null;
  label: string;
  plan: { id: string; appName: string } | null;
  inLibrary: boolean;
}
interface FoundFolder {
  path: string;
  error?: string;
  projects: Found[];
}

/**
 * Your projects: every plan in the library (~/.stackwise, through the same store the canvas
 * uses), the projects StackWise found under your folders, and the examples. Opening one here
 * switches to it on the canvas.
 */
export default function ProjectsView() {
  const router = useRouter();
  const [me] = useMe();
  const [history, setHistory] = useState<History>(loadHistory);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [folders, setFolders] = useState<FoundFolder[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { store } = history;
  const now = () => new Date().toISOString();

  // The library on disk is the record: take anything newer there, once, when the page opens.
  useEffect(() => {
    let stopped = false;
    void pullLibrary(history.store).then((merged) => {
      if (!stopped && merged) setHistory({ store: merged, past: [], future: [] });
    });
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { folders: FoundFolder[] } | null) => {
        if (!stopped && body) setFolders(body.folders);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, with whatever the browser had
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /** Run store actions, save, and optionally go to the canvas. */
  const apply = (actions: StoreAction[], open = false) => {
    const next = actions.reduce((h, action) => reduce(h, action), history);
    saveStore(next.store);
    setHistory(next);
    if (open) router.push("/");
  };

  const open = (id: string) => apply([{ type: "switchPlan", id }], true);
  const duplicate = (id: string) => {
    const name = store.plans[id].appName.trim() || "Untitled app";
    // Duplicating works on the open project, so switch to it, copy it, and leave the one that was open.
    apply([{ type: "switchPlan", id }, { type: "duplicatePlan", id: newId(), now: now() }, { type: "switchPlan", id: store.activeId }]);
    setToast(`Duplicated ${name}.`);
  };
  const remove = (id: string) => {
    const name = store.plans[id].appName.trim() || "Untitled app";
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    const wasOpen = store.activeId;
    deletePlanOnDisk(id);
    const actions: StoreAction[] = [{ type: "switchPlan", id }, { type: "deletePlan", now: now(), fallbackId: newId() }];
    if (wasOpen !== id) actions.push({ type: "switchPlan", id: wasOpen });
    apply(actions);
    setToast(`Deleted ${name}.`);
  };
  const openFile = async (file: File) => {
    const { actions, message } = await readPlanFile(file, store, newId);
    if (actions.length) apply(actions, true);
    else setToast(message);
  };

  const q = query.trim().toLowerCase();
  const mine = store.order.filter((id) => store.plans[id]).filter((id) => !q || `${store.plans[id].appName} ${store.plans[id].description} ${store.plans[id].folder ?? ""}`.toLowerCase().includes(q));
  /** A plan's folder as a full path, so "~/Projects/x" and "/Users/me/Projects/x" are the same project. */
  const absolute = (folder: string) => folder.replace(/^~(?=\/|$)/, me?.home ?? "~").replace(/\/+$/, "");
  const planByFolder = useMemo(() => new Map(Object.values(store.plans).filter((p) => p.folder).map((p) => [absolute(p.folder!), p.id])), [store.plans, me?.home]); // eslint-disable-line react-hooks/exhaustive-deps -- absolute reads me.home
  // Projects on disk that aren't in the library yet, or are and can be opened.
  const found = (folders ?? []).flatMap((f) => f.projects).filter((p) => !q || `${p.name} ${p.label}`.toLowerCase().includes(q));
  const greeting = me?.profile.name.trim() || me?.account || "";

  return (
    <Shell me={me}>
      <div className="shell-head">
        <div className="mk-stack mk-gap-1">
          <h1 className="shell-title">{greeting ? `Welcome back, ${greeting.split(" ")[0]}` : "Your projects"}</h1>
          <p className="mk-muted">
            {store.order.length} plan{store.order.length === 1 ? "" : "s"} in {me ? shortPath(me.dir, me.home) : "your library"}. Open one to keep planning it.
          </p>
        </div>
        <div className="shell-actions">
          <input className="mk-input mk-sm shell-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search projects" />
          <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => fileInput.current?.click()}>
            Open plan file
          </button>
          <button type="button" className="mk-btn mk-btn--primary mk-sm" onClick={() => apply([{ type: "newPlan", id: newId(), now: now(), defaults: planDefaults() }], true)}>
            <Icon name="plus" size={14} /> New project
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void openFile(file);
            }}
          />
        </div>
      </div>

      <section className="shell-section">
        <div className="shell-section__head">
          <h2 className="shell-h2">My projects</h2>
        </div>
        <ul className="apps-grid">
          {mine.map((id) => {
            const plan = store.plans[id];
            const name = plan.appName.trim() || "Untitled app";
            const active = id === store.activeId;
            return (
              <li key={id} className="apps-card">
                <button type="button" className="apps-card__open" onClick={() => open(id)} aria-label={`Open ${name}`}>
                  <AppIcon plan={plan} />
                  <span className="apps-card__text">
                    <strong>{name}</strong>
                    <span className="apps-card__meta">
                      {plan.step === "plan" ? "Planned" : "Draft"} · {updated(plan.updatedAt)}
                      {plan.folder && <span title={plan.folder}>· {shortPath(plan.folder, me?.home).split("/").pop()}</span>}
                      {active && <span className="mk-badge mk-badge--accent">Open now</span>}
                    </span>
                    {plan.description.trim() && <span className="apps-card__desc">{plan.description.trim()}</span>}
                  </span>
                </button>
                <div className="apps-card__tools">
                  <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => duplicate(id)}>
                    Duplicate
                  </button>
                  <button type="button" className="mk-btn mk-btn--ghost mk-sm apps-danger" onClick={() => remove(id)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
          {mine.length === 0 && <li className="mk-muted">{q ? "Nothing matches." : "No plans yet. Start one with New project, or plan a project found below."}</li>}
        </ul>
      </section>

      <section className="shell-section">
        <div className="shell-section__head">
          <div className="mk-stack mk-gap-1">
            <h2 className="shell-h2">On this computer</h2>
            <p className="mk-muted">
              Projects under {me ? me.profile.folders.join(", ") : "your folders"}. Change the folders in Settings.
            </p>
          </div>
        </div>
        {folders === null && <p className="mk-hint">Looking...</p>}
        {folders?.map((f) => f.error && <p key={f.path} className="mk-hint">{f.path}: {f.error}</p>)}
        <ul className="apps-grid">
          {found.map((p) => {
            const linkedId = p.plan && store.plans[p.plan.id] ? p.plan.id : planByFolder.get(absolute(p.path));
            return (
              <li key={p.path} className="apps-card apps-card--found">
                <button type="button" className="apps-card__open" onClick={() => (linkedId ? open(linkedId) : router.push(`/#open=${encodeURIComponent(p.path)}`))} aria-label={linkedId ? `Open the plan for ${p.name}` : `Plan ${p.name}`}>
                  <AppIcon plan={{ appName: p.name, icon: linkedId ? store.plans[linkedId].icon : undefined }} found={!linkedId} />
                  <span className="apps-card__text">
                    <strong>{p.plan?.appName || p.name}</strong>
                    <span className="apps-card__meta">
                      {p.label}
                      {p.plan && !linkedId && <span className="mk-badge">Has a plan file</span>}
                      {linkedId && <span className="mk-badge mk-badge--accent">In your library</span>}
                    </span>
                    <span className="apps-card__desc">{p.short}</span>
                  </span>
                </button>
                <div className="apps-card__tools">
                  {linkedId ? (
                    <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => open(linkedId)}>
                      Open
                    </button>
                  ) : (
                    <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => router.push(`/#open=${encodeURIComponent(p.path)}`)}>
                      {p.plan ? "Open its plan" : "Plan this project"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {folders !== null && found.length === 0 && <li className="mk-muted">Nothing found. Add the folder your projects live in, in Settings.</li>}
        </ul>
      </section>

      <section className="shell-section">
        <div className="mk-stack mk-gap-1">
          <h2 className="shell-h2">Examples</h2>
          <p className="mk-muted">Finished plans to look around in. Opening one adds a copy to your projects.</p>
        </div>
        <ul className="apps-grid">
          {DEMOS.map((demo) => {
            const openExample = () => apply([{ type: "importPlan", id: newId(), now: now(), plan: structuredClone(demo.plan) }], true);
            return (
              <li key={demo.id} className="apps-card apps-card--example">
                <button type="button" className="apps-card__open" onClick={openExample} aria-label={`Open the ${demo.plan.appName} example`}>
                  <AppIcon plan={{ appName: demo.plan.appName }} />
                  <span className="apps-card__text">
                    <strong>{demo.plan.appName}</strong>
                    <span className="apps-card__meta">{demo.label}</span>
                    <span className="apps-card__desc">{demo.plan.description}</span>
                  </span>
                </button>
                <div className="apps-card__tools">
                  <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={openExample}>
                    Open example
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {toast && (
        <div className="ws-toast" role="status">
          {toast}
        </div>
      )}
    </Shell>
  );
}
