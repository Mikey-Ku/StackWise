"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSpecPack } from "@/engine";
import type { PlanModel } from "./usePlan";
import { cx } from "./ui";

export function SpecDialog({ plan, generatedOn, onClose }: { plan: PlanModel; generatedOn: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const open = generatedOn !== null;
  const { state, index, input, rec } = plan;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const files = useMemo(
    () =>
      generatedOn
        ? buildSpecPack(index, input, rec.selection, {
            appName: state.appName,
            description: state.description,
            features: state.features,
            builderId: state.builderId,
            generatedOn,
          })
        : [],
    [generatedOn, index, input, rec.selection, state.appName, state.description, state.features, state.builderId],
  );
  const file = files[Math.min(active, files.length - 1)];

  const download = (name: string, content: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <dialog ref={ref} className="mk-modal ws-spec" onClose={onClose}>
      <div className="mk-modal__body mk-stack mk-gap-4">
        <div className="mk-row mk-gap-3">
          <div className="mk-grow mk-stack mk-gap-1">
            <span className="mk-eyebrow">Spec pack</span>
            <h3>Hand this to your builder</h3>
          </div>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mk-tabs" role="tablist">
          {files.map((f, i) => (
            <button
              key={f.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={cx("mk-tab", i === active && "ws-tab-on")}
              onClick={() => {
                setActive(i);
                setCopied(false);
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
        {file && <pre className="mk-code ws-spec__pre">{file.content}</pre>}
        <div className="mk-row mk-gap-3 mk-wrap">
          <button
            type="button"
            className="mk-btn mk-btn--primary mk-sm"
            onClick={async () => {
              if (!file) return;
              await navigator.clipboard.writeText(file.content);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : `Copy ${file?.name ?? ""}`}
          </button>
          <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => file && download(file.name, file.content)}>
            Download {file?.name}
          </button>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => files.forEach((f) => download(f.name, f.content))}>
            Download all {files.length}
          </button>
        </div>
      </div>
    </dialog>
  );
}
