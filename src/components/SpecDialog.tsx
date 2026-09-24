"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildProjectPack } from "@/engine";
import { toSharedPlan } from "./store";
import type { PlanModel } from "./usePlans";
import { copyText, downloadZip } from "./ui";

/** What POST /api/local says it would do, or did. */
interface LocalReport {
  path: string;
  folderExists: boolean;
  write: string[];
  keep: { name: string; why: string }[];
  missingEnv: string[];
  command: string;
  wrote: string[];
}

/** The project pack: the spec, setup, tasks and plan file, plus Claude Code's agents and MCP config when that's the builder. */
export function SpecDialog({
  model,
  generatedOn,
  whystackRoot,
  onClose,
  onToast,
  onSaveImage,
}: {
  model: PlanModel;
  generatedOn: string | null;
  whystackRoot: string | undefined;
  onClose: () => void;
  onToast: (message: string) => void;
  /** Saves the diagram as a PNG, with the page's background or none. */
  onSaveImage: (transparent: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState("SPEC.md");
  const [copied, setCopied] = useState(false);
  const [where, setWhere] = useState("");
  const [replace, setReplace] = useState(false);
  const [report, setReport] = useState<LocalReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = generatedOn !== null;
  const { plan, index, input, rec } = model;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const files = useMemo(
    () =>
      generatedOn
        ? buildProjectPack(
            index,
            input,
            rec.selection,
            {
              appName: plan.appName,
              description: plan.description,
              features: plan.features,
              builderId: plan.builderId,
              generatedOn,
              planId: plan.id,
              plan: toSharedPlan(plan),
            },
            { whystackRoot },
          )
        : [],
    [generatedOn, index, input, rec.selection, plan, whystackRoot],
  );
  const file = files.find((f) => f.name === active) ?? files[0];
  const builder = model.catalog.planning.builders.find((b) => b.id === plan.builderId);
  const folder = (plan.appName.trim() || "my-app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-app";
  const agents = files.filter((f) => f.name.startsWith(".claude/agents/")).length;
  const beside = whystackRoot ? `${whystackRoot.split("/").slice(0, -1).join("/")}/${folder}` : `~/${folder}`;

  const send = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: where || beside, id: plan.id, plan: toSharedPlan(plan), generatedOn, dryRun, replace }),
      });
      const body = (await response.json()) as LocalReport & { error?: string };
      if (!response.ok || body.error) {
        setError(body.error ?? `The server said no (${response.status}).`);
        setReport(null);
        return;
      }
      setReport(body);
      if (!dryRun) {
        model.dispatch({ type: "setFolder", folder: body.path });
        onToast(`Wrote ${body.wrote.length} file${body.wrote.length === 1 ? "" : "s"} into ${body.path}.`);
      }
    } catch {
      setError("Couldn't reach StackWise's server. It writes files only while the app is running on this computer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="mk-modal ws-spec" onClose={onClose}>
      <div className="mk-modal__body mk-stack mk-gap-4">
        <div className="mk-row mk-gap-3">
          <div className="mk-grow mk-stack mk-gap-1">
            <span className="mk-eyebrow">Project pack</span>
            <h3>Hand this to {builder?.label ?? "your builder"}</h3>
          </div>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mk-muted">
          {files.length} files: the spec, setup steps, an ordered task list and the plan itself
          {agents ? `, plus ${agents} Claude Code agents, skills like /next-step, and the StackWise MCP server so Claude checks every stack change with StackWise` : ""}. Unzip it as your project folder.
          {builder?.format === "claude-md" && !whystackRoot ? " StackWise's folder couldn't be found, so .mcp.json is left out; see docs/MCP.md to add it." : ""}
        </p>
        <label className="mk-field ws-spec__pick">
          <span className="mk-label">File</span>
          <select
            className="mk-select mk-sm"
            value={file?.name}
            onChange={(e) => {
              setActive(e.target.value);
              setCopied(false);
            }}
          >
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {file && <pre className="mk-code ws-spec__pre">{file.content}</pre>}
        <div className="mk-row mk-gap-3 mk-wrap">
          <button
            type="button"
            className="mk-btn mk-btn--primary mk-sm"
            onClick={() => {
              downloadZip(`${folder}.zip`, folder, files);
              onToast(`Downloaded ${folder}.zip with ${files.length} files.`);
            }}
          >
            Download project (.zip)
          </button>
          <button
            type="button"
            className="mk-btn mk-btn--secondary mk-sm"
            onClick={async () => {
              if (file) setCopied(await copyText(file.content));
            }}
          >
            {copied ? "Copied" : `Copy ${file?.name ?? ""}`}
          </button>
        </div>

        <section className="mk-stack mk-gap-3 ws-local">
          <div className="mk-stack mk-gap-1">
            <span className="mk-eyebrow">Or write it into a folder on this computer</span>
            <p className="mk-muted">
              The same files, in a folder you can open straight away, plus a <code>.env.local</code> with the names your stack needs and no values. StackWise never writes over an existing{" "}
              <code>.env.local</code>, and only writes inside your home folder.
            </p>
          </div>
          <div className="mk-row mk-gap-2 mk-wrap ws-local__row">
            <label className="mk-field mk-grow">
              <span className="mk-label">Folder</span>
              <input className="mk-input mk-sm" value={where} placeholder={plan.folder ?? beside} onChange={(e) => setWhere(e.target.value)} spellCheck={false} />
            </label>
            <button type="button" className="mk-btn mk-btn--ghost mk-sm" disabled={busy} onClick={() => void send(true)}>
              {busy ? "Looking" : "Check the folder"}
            </button>
            <button type="button" className="mk-btn mk-btn--primary mk-sm" disabled={busy} onClick={() => void send(false)}>
              Write the files
            </button>
          </div>
          {error && <p className="mk-alert mk-alert--danger">{error}</p>}
          {report && (
            <div className="mk-stack mk-gap-2">
              <p>
                {report.wrote.length > 0 ? (
                  <>
                    <strong>
                      Wrote {report.wrote.length} file{report.wrote.length === 1 ? "" : "s"}
                    </strong>{" "}
                    into <code>{report.path}</code>.
                  </>
                ) : (
                  <>
                    <strong>
                      {report.write.length} file{report.write.length === 1 ? "" : "s"} to write
                    </strong>{" "}
                    into <code>{report.path}</code>
                    {report.folderExists ? "" : ", a new folder"}.
                  </>
                )}
              </p>
              {report.keep.length > 0 && (
                <div className="mk-stack mk-gap-1">
                  <p className="mk-muted">
                    Left alone, because {report.keep.length === 1 ? "it's" : "they're"} already there: {report.keep.slice(0, 4).map((k) => k.name).join(", ")}
                    {report.keep.length > 4 ? ` and ${report.keep.length - 4} more` : ""}.
                  </p>
                  {report.keep.some((k) => k.name === ".env.local") && (
                    <p className="mk-hint">
                      Your <code>.env.local</code> is one of them. Your real values live in it, so StackWise never writes over it.
                    </p>
                  )}
                  {report.keep.some((k) => k.name !== ".env.local") && (
                    <label className="mk-row mk-gap-2">
                      <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                      <span>Replace files that are already there</span>
                    </label>
                  )}
                </div>
              )}
              {report.missingEnv.length > 0 && (
                <p className="mk-muted">
                  Your <code>.env.local</code> there is missing {report.missingEnv.length} name{report.missingEnv.length === 1 ? "" : "s"}: {report.missingEnv.join(", ")}.{" "}
                  {report.missingEnv.length === 1 ? "It's" : "They're"} in <code>.env.example</code>.
                </p>
              )}
              {report.wrote.length > 0 && (
                <div className="mk-row mk-gap-2 mk-wrap">
                  <code className="mk-code ws-local__cmd">{`${report.command}${builder?.format === "claude-md" ? " && claude" : ""}`}</code>
                  <button
                    type="button"
                    className="mk-btn mk-btn--secondary mk-sm"
                    onClick={async () =>
                      onToast((await copyText(`${report.command}${builder?.format === "claude-md" ? " && claude" : ""}`)) ? "Copied. Paste it into a terminal." : "Couldn't copy.")
                    }
                  >
                    Copy the command
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="mk-stack mk-gap-3 ws-local">
          <div className="mk-stack mk-gap-1">
            <span className="mk-eyebrow">The diagram, for slides</span>
            <p className="mk-muted">A sharp PNG of every part and connection at full size. Leave the background out to drop it onto any slide.</p>
          </div>
          <div className="mk-row mk-gap-2 mk-wrap">
            <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => onSaveImage(false)}>
              Save as PNG
            </button>
            <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => onSaveImage(true)}>
              PNG, no background
            </button>
          </div>
        </section>
      </div>
    </dialog>
  );
}
