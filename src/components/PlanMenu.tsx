"use client";

import { useRef } from "react";
import { encodeSharedPlan, sharedPlanSchema } from "@/engine";
import { DEMOS } from "./demos";
import { toSharedPlan } from "./store";
import { newId, type PlanModel } from "./usePlans";
import { copyText, cx, downloadText } from "./ui";

/** Switch between saved plans, and move a plan between people: share links and plan files. */
export function PlanMenu({ model, onToast }: { model: PlanModel; onToast: (message: string) => void }) {
  const { store, plan, dispatch } = model;
  const menu = useRef<HTMLDetailsElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const close = () => menu.current?.removeAttribute("open");
  const now = () => new Date().toISOString();
  const nameOf = (id: string) => store.plans[id].appName.trim() || "Untitled app";

  const shareLink = async () => {
    close();
    const token = await encodeSharedPlan(toSharedPlan(plan));
    const url = `${window.location.origin}${window.location.pathname}#plan=${token}`;
    onToast((await copyText(url)) ? "Share link copied. Anyone who opens it gets their own copy of this plan." : url);
  };

  const exportFile = () => {
    close();
    const slug = (plan.appName.trim() || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadText(`${slug}.whystack.json`, JSON.stringify({ whystack: "plan", ...toSharedPlan(plan) }, null, 2), "application/json");
  };

  const importFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as { whystack?: unknown; id?: unknown; plan?: unknown };
      // A project's whystack.plan.json keeps its plan id, so importing it reconnects to that plan.
      if (raw.whystack === 1 && raw.plan && typeof raw.id === "string") {
        const parsed = sharedPlanSchema.safeParse(raw.plan);
        if (!parsed.success) throw new Error("not a plan");
        if (store.plans[raw.id]) {
          dispatch({ type: "switchPlan", id: raw.id });
          dispatch({ type: "applyRemote", id: raw.id, plan: parsed.data });
          onToast(`Updated ${parsed.data.appName || "the plan"} from its project file.`);
        } else {
          dispatch({ type: "importPlan", id: /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : newId(), now: now(), plan: parsed.data });
          onToast(`Imported ${parsed.data.appName || "a plan"} from its project file.`);
        }
        return;
      }
      const parsed = sharedPlanSchema.safeParse(raw);
      if (!parsed.success) throw new Error("not a plan");
      dispatch({ type: "importPlan", id: newId(), now: now(), plan: parsed.data });
      onToast(`Imported ${parsed.data.appName || "a plan"}.`);
    } catch {
      onToast("That file isn't a StackWise plan.");
    }
  };

  const updated = (iso: string) => {
    const date = new Date(iso);
    return date.toDateString() === new Date().toDateString()
      ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <details ref={menu} className="ws-menu">
      <summary className="ws-menu__button">
        <span className="ws-top__app">{plan.appName.trim() || "Untitled app"}</span>
        <span className="mk-faint" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="ws-menu__panel">
        <span className="mk-eyebrow">Your applications</span>
        <div className="ws-menu__list">
          {store.order.map((id) => (
            <button
              key={id}
              type="button"
              className={cx("ws-menu__item", id === store.activeId && "is-active")}
              onClick={() => {
                dispatch({ type: "switchPlan", id });
                close();
              }}
            >
              <span>{nameOf(id)}</span>
              <span className="mk-hint">
                {store.plans[id].step === "plan" ? "planned" : "in progress"}, {updated(store.plans[id].updatedAt)}
              </span>
            </button>
          ))}
        </div>
        <div className="ws-menu__actions">
          <button type="button" className="ws-menu__item" onClick={() => (dispatch({ type: "newPlan", id: newId(), now: now() }), close())}>
            New application
          </button>
          {DEMOS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              className="ws-menu__item"
              onClick={() => {
                close();
                dispatch({ type: "importPlan", id: newId(), now: now(), plan: structuredClone(demo.plan) });
                onToast(`Opened the ${demo.plan.appName} demo.`);
              }}
            >
              <span>Open a demo</span>
              <span className="mk-hint">{demo.plan.appName}, an {demo.label}</span>
            </button>
          ))}
          <button type="button" className="ws-menu__item" onClick={() => (dispatch({ type: "duplicatePlan", id: newId(), now: now() }), close())}>
            Duplicate this application
          </button>
          <button type="button" className="ws-menu__item" onClick={shareLink}>
            Copy share link
          </button>
          <button type="button" className="ws-menu__item" onClick={exportFile}>
            Export plan file
          </button>
          <button type="button" className="ws-menu__item" onClick={() => fileInput.current?.click()}>
            Import plan file
          </button>
          <button
            type="button"
            className="ws-menu__item ws-menu__item--danger"
            onClick={() => {
              close();
              if (window.confirm(`Delete "${nameOf(store.activeId)}"? This can't be undone.`)) dispatch({ type: "deletePlan", now: now(), fallbackId: newId() });
            }}
          >
            Delete this application
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            close();
            if (file) void importFile(file);
          }}
        />
      </div>
    </details>
  );
}
