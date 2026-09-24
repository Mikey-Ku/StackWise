"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { DEMOS } from "@/components/demos";
import { Icon } from "@/components/icons";
import { readPlanFile } from "@/components/planFiles";
import { loadHistory, newId, saveStore } from "@/components/savedStore";
import { migrateLegacyStorage } from "@/components/storage";
import { reduce, type History, type PlanState, type StoreAction } from "@/components/store";
import { ThemeSwitch } from "@/components/ThemeSwitch";

// Saved data from before StackWise's rename moves to its new keys before anything reads it.
if (typeof window !== "undefined") migrateLegacyStorage();

const updated = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? `today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

function AppIcon({ plan }: { plan: Pick<PlanState, "appName" | "icon"> }) {
  return (
    <span className="apps-icon" aria-hidden>
      {plan.icon ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small data URL the person chose
        <img src={plan.icon} alt="" />
      ) : (
        (plan.appName.trim() || "U").slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/**
 * Every application saved in this browser, and the examples. It reads and writes the same store
 * as the workspace (savedStore.ts) through the same reducer, so opening one here switches to it
 * there, and nothing here can leave the two out of step.
 */
export default function AppsView() {
  const router = useRouter();
  const [history, setHistory] = useState<History>(loadHistory);
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { store } = history;
  const now = () => new Date().toISOString();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /** Run store actions, save, and optionally go to the workspace. */
  const apply = (actions: StoreAction[], open = false) => {
    const next = actions.reduce((h, action) => reduce(h, action), history);
    saveStore(next.store);
    setHistory(next);
    if (open) router.push("/");
  };

  const open = (id: string) => apply([{ type: "switchPlan", id }], true);
  const duplicate = (id: string) => {
    const name = store.plans[id].appName.trim() || "Untitled app";
    // Duplicating works on the open application, so switch to it, copy it, and leave the one that was open.
    apply([{ type: "switchPlan", id }, { type: "duplicatePlan", id: newId(), now: now() }, { type: "switchPlan", id: store.activeId }]);
    setToast(`Duplicated ${name}.`);
  };
  const remove = (id: string) => {
    const name = store.plans[id].appName.trim() || "Untitled app";
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    const wasOpen = store.activeId;
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

  return (
    <div className="apps">
      <header className="apps-top">
        <div className="apps-top__inner">
          <Link href="/" className="apps-brand" aria-label="StackWise, back to your plan">
            <BrandMark size={26} />
            <span className="apps-brand__name">StackWise</span>
            <span className="apps-brand__sep" aria-hidden="true">
              /
            </span>
            <span className="apps-brand__page">Applications</span>
          </Link>
          <span className="apps-top__actions">
            <ThemeSwitch className="mk-btn mk-btn--ghost mk-sm apps-theme" />
            <Link href="/" className="mk-btn mk-sm apps-back">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Back to your plan</span>
            </Link>
          </span>
        </div>
      </header>

      <main className="apps-main">
        <div className="apps-head">
          <div className="mk-stack mk-gap-1">
            <h1 className="apps-title">Your applications</h1>
            <p className="mk-muted">Saved in this browser. Open one to keep planning it.</p>
          </div>
          <div className="apps-actions">
            <button type="button" className="mk-btn mk-btn--primary mk-sm" onClick={() => apply([{ type: "newPlan", id: newId(), now: now() }], true)}>
              <Icon name="plus" size={14} /> New application
            </button>
            <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={() => fileInput.current?.click()}>
              Open plan file
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

        <ul className="apps-grid">
          {store.order.map((id) => {
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
        </ul>

        <section className="apps-examples">
          <div className="mk-stack mk-gap-1">
            <h2 className="apps-h2">Examples</h2>
            <p className="mk-muted">Finished plans to look around in. Opening one adds a copy to your applications.</p>
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
      </main>

      {toast && (
        <div className="ws-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
