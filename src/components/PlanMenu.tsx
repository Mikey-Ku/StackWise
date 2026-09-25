"use client";

import Link from "next/link";
import { useRef } from "react";
import { encodeSharedPlan } from "@/engine";
import { downloadPlanFile, readPlanFile } from "./planFiles";
import { toSharedPlan } from "./store";
import { newId, type PlanModel } from "./usePlans";
import { copyText, cx } from "./ui";

/** Switch between saved applications, and move one between people: share links and plan files. All of them, and the examples, are on /apps. */
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
    onToast((await copyText(url)) ? "Share link copied. It opens in StackWise running on their computer, as their own copy." : url);
  };

  const exportFile = () => {
    close();
    downloadPlanFile(plan);
  };

  const importFile = async (file: File) => {
    const { actions, message } = await readPlanFile(file, store, newId);
    for (const action of actions) dispatch(action);
    onToast(message);
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
                {store.plans[id].step === "plan" ? "planned" : "draft"}, {updated(store.plans[id].updatedAt)}
              </span>
            </button>
          ))}
        </div>
        <div className="ws-menu__actions">
          <button type="button" className="ws-menu__item" onClick={() => (dispatch({ type: "newPlan", id: newId(), now: now() }), close())}>
            New application
          </button>
          <Link href="/apps" className="ws-menu__item" onClick={close}>
            All applications
          </Link>
          <button type="button" className="ws-menu__item" onClick={() => (dispatch({ type: "duplicatePlan", id: newId(), now: now() }), close())}>
            Duplicate this application
          </button>
          <button type="button" className="ws-menu__item" onClick={shareLink}>
            Copy share link
          </button>
          <button type="button" className="ws-menu__item" onClick={exportFile}>
            Download plan file
          </button>
          <button type="button" className="ws-menu__item" onClick={() => fileInput.current?.click()}>
            Open plan file
          </button>
          <Link href="/review" className="ws-menu__item" onClick={close}>
            Review facts
          </Link>
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
