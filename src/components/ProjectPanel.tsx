"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { planEnv } from "@/engine";
import { Icon } from "./icons";
import type { PlanModel } from "./usePlans";
import { cx, imageToIcon } from "./ui";

/**
 * The plan's project folder: link it, see which of the plan's environment variables it has set,
 * and set the missing ones without opening a file. Everything goes through /api/project, which
 * only this computer can call. Values go from this page into the project's .env.local and never
 * come back: the page only ever sees names and whether each is set.
 */

interface Inspection {
  folder: string;
  exists: boolean;
  framework: string | null;
  label: string;
  env: { name: string; set: boolean; files: string[] }[];
  configRefs: string[];
  envIgnored: boolean;
  issues: string[];
  icon: string | null;
}

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

/** The app's own logo: found in the project, or chosen by the person. Kept with the plan. */
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
              {" · "}
              <button type="button" className="ws-link" onClick={() => void fromProject()}>
                Use {found.split("/").pop()}
              </button>
            </>
          )}
          {plan.icon && (
            <>
              {" · "}
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

export function ProjectPanel({ model, onToast }: { model: PlanModel; onToast: (message: string) => void }) {
  const { plan, dispatch, index, rec } = model;
  const [draft, setDraft] = useState(plan.folder ?? "");
  const [project, setProject] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = plan.folder;

  const load = useCallback(
    async (folder: string) => {
      try {
        const found = await call<Inspection>({ action: "inspect", path: folder });
        setProject(found);
        // Keep the full path, so a later `stackwise` in that folder finds this plan.
        if (found.folder !== folder) dispatch({ type: "setFolder", folder: found.folder });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that folder.");
      }
    },
    [dispatch],
  );

  useEffect(() => {
    if (!path) return;
    const timer = window.setTimeout(() => void load(path), 0);
    return () => window.clearTimeout(timer);
  }, [path, load]);

  const env = useMemo(() => planEnv(index, rec.selection, plan.extras), [index, rec.selection, plan.extras]);

  if (!path || !project) {
    return (
      <div className="ws-proj">
        <p className="mk-muted">Link your project folder to see which of the plan&apos;s keys it has, set the missing ones, and keep its plan file up to date. Nothing leaves this computer.</p>
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

      <Section title={`Environment${missing ? `, ${missing} missing` : ""}`} icon="note" right={<span className="mk-hint">Writes to .env.local</span>}>
        {!project.envIgnored && !project.issues.some((issue) => issue.includes(".gitignore")) && <p className="ws-proj__error">.env.local isn&apos;t in .gitignore. Add it before you set any keys, so they never get committed.</p>}
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
    </div>
  );
}
