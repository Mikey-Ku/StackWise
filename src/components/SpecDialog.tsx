"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildProjectPack } from "@/engine";
import { toSharedPlan } from "./store";
import type { PlanModel } from "./usePlans";
import { copyText, downloadZip } from "./ui";

/** The project pack: the spec, setup, tasks and plan file, plus Claude Code's agents and MCP config when that's the builder. */
export function SpecDialog({
  model,
  generatedOn,
  whystackRoot,
  onClose,
  onToast,
}: {
  model: PlanModel;
  generatedOn: string | null;
  whystackRoot: string | undefined;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState("SPEC.md");
  const [copied, setCopied] = useState(false);
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
          {agents ? `, plus ${agents} Claude Code agents, skills like /next-step, and the WhyStack MCP server so Claude checks every stack change with WhyStack` : ""}. Unzip it as your project folder.
          {builder?.format === "claude-md" && !whystackRoot ? " WhyStack's folder couldn't be found, so .mcp.json is left out; see docs/MCP.md to add it." : ""}
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
      </div>
    </dialog>
  );
}
