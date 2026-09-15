"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSpecPack } from "@/engine";
import type { PlanModel } from "./usePlans";
import { copyText, cx, downloadText } from "./ui";

export function SpecDialog({ model, generatedOn, onClose }: { model: PlanModel; generatedOn: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(0);
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
        ? buildSpecPack(index, input, rec.selection, {
            appName: plan.appName,
            description: plan.description,
            features: plan.features,
            builderId: plan.builderId,
            generatedOn,
          })
        : [],
    [generatedOn, index, input, rec.selection, plan.appName, plan.description, plan.features, plan.builderId],
  );
  const file = files[Math.min(active, files.length - 1)];
  const builder = model.catalog.planning.builders.find((b) => b.id === plan.builderId);

  return (
    <dialog ref={ref} className="mk-modal ws-spec" onClose={onClose}>
      <div className="mk-modal__body mk-stack mk-gap-4">
        <div className="mk-row mk-gap-3">
          <div className="mk-grow mk-stack mk-gap-1">
            <span className="mk-eyebrow">Spec pack</span>
            <h3>Hand this to {builder?.label ?? "your builder"}</h3>
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
              if (file) setCopied(await copyText(file.content));
            }}
          >
            {copied ? "Copied" : `Copy ${file?.name ?? ""}`}
          </button>
          <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => file && downloadText(file.name, file.content)}>
            Download {file?.name}
          </button>
          <button type="button" className="mk-btn mk-btn--ghost mk-sm" onClick={() => files.forEach((f) => downloadText(f.name, f.content))}>
            Download all {files.length}
          </button>
        </div>
      </div>
    </dialog>
  );
}
