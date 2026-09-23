"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { connectionsOf, decodeSharedPlan, envFileText, planEnv, staleFacts, todayIso, type Catalog, type SharedPlan, type SlotId } from "@/engine";
import { presence } from "@/mcp/pairing";
import { AddPart } from "./AddPart";
import { BrandMark } from "./BrandMark";
import { AskPanel, type AskRequest } from "./AskPanel";
import { live, pickDefault, readDefaultAnswerer, recipientsFor, saveDefaultAnswerer, STATE_TEXT } from "./answerers";
import { ConnectPanel } from "./ConnectPanel";
import { ChecklistPanel } from "./ChecklistPanel";
import { CompareDialog, type CompareRequest } from "./CompareDialog";
import { ConnectionPanel } from "./ConnectionPanel";
import { ContextMenu, type MenuItem, type MenuRequest } from "./ContextMenu";
import { Icon, type IconName } from "./icons";
import { Inspector } from "./Inspector";
import { LearnPanel } from "./LearnPanel";
import { Palette } from "./Palette";
import { HIDEABLE_PARTS, PlanCanvas, tidySpots, visibleParts, type CanvasTarget } from "./PlanCanvas";
import { PlanMenu } from "./PlanMenu";
import { ProjectPanel } from "./ProjectPanel";
import { Overview, Planner, SummaryPill, type AiStatus } from "./Planner";
import { SpecDialog } from "./SpecDialog";
import { usePairing, type ClaudeActivity } from "./usePairing";
import { newId, usePlans } from "./usePlans";
import { Logo, copyText, cx } from "./ui";

/**
 * The workspace is the canvas, full screen, with everything else floating over it:
 *   - a bar on top: plans, the plan in one line, Ask and Export
 *   - a dock at the bottom: Overview, Parts, Checklist, Learn, undo and redo
 *   - one panel on the left from the dock, and Details on the right when something is picked
 *   - the Ask panel (Cmd+K), for talking to Claude or a paired coding agent
 *   - right-click menus on parts, lines and the canvas
 * Describing the app and confirming the guesses happen in a sheet over the canvas, which fills in
 * behind it as the answers change.
 */

type Panel = "overview" | "project" | "options" | "checklist" | "learn";
const PANELS: { id: Panel; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "project", label: "Project", icon: "terminal" },
  { id: "options", label: "Parts", icon: "parts" },
  { id: "checklist", label: "Checklist", icon: "checklist" },
  { id: "learn", label: "Learn", icon: "learn" },
];

const CONNECT_SEEN_KEY = "whystack.connect-seen";
const readFlag = (key: string) => {
  try {
    return window.localStorage.getItem(key) === "yes";
  } catch {
    return false;
  }
};

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export default function Workspace({ catalog, problems }: { catalog: Catalog; problems: string[] }) {
  const model = usePlans(catalog);
  const { plan, dispatch, history, rec, index } = model;
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(null);
  /** The part at the far end of the connection being looked at, when one is. */
  const [connection, setConnection] = useState<SlotId | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [learnFocus, setLearnFocus] = useState<SlotId | null>(null);
  const [ask, setAsk] = useState<{ open: boolean; slot: SlotId; request: AskRequest | null }>({ open: false, slot: "framework", request: null });
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [specDate, setSpecDate] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareRequest | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  /** Who answers by default, saved in this browser. Shared by the Connect screen, the pill and Ask. */
  const [savedDefault, setSavedDefault] = useState<string | null>(readDefaultAnswerer);
  /** Connecting the AI comes first, once per browser. */
  const [connectSeen, setConnectSeen] = useState(() => readFlag(CONNECT_SEEN_KEY));
  const [connectOpen, setConnectOpen] = useState(false);
  /** The Connect step, reopened from the steps at the top of the planner sheet. */
  const [connectAgain, setConnectAgain] = useState(false);
  /** The add-a-part picker, and the part it opened for, if any. */
  const [adding, setAdding] = useState<{ focus: SlotId | null } | null>(null);

  const onClaudeChange = useCallback((appName: string, change: ClaudeActivity | undefined) => {
    const what = change ? `${change.summary}${change.changes.length ? `: ${change.changes.slice(0, 2).join("; ")}${change.changes.length > 2 ? ` (+${change.changes.length - 2})` : ""}` : ""}` : "updated the plan";
    setToast(`Your agent changed ${appName.trim() || "your plan"}. ${what}. Undo reverses it.`);
  }, []);
  const pairing = usePairing({ history, dispatch, onClaudeChange });
  const today = useMemo(() => todayIso(), []);
  const stale = useMemo(() => staleFacts(catalog, today).length, [catalog, today]);
  const building = plan.step === "plan";
  /** The first agent listening on this plan, for the dot on the Ask button. */
  const listening = Object.values(pairing.agents).find((agent) => presence(agent, pairing.serverNow) === "listening")?.name;
  const recipients = recipientsFor(ai, pairing);
  const answerer = recipients.find((r) => r.id === pickDefault(recipients, savedDefault))!;
  const chooseAnswerer = useCallback((id: string) => {
    saveDefaultAnswerer(id);
    setSavedDefault(id);
  }, []);
  const finishConnect = () => {
    try {
      window.localStorage.setItem(CONNECT_SEEN_KEY, "yes");
    } catch {
      // Private windows: the Connect screen shows again next time.
    }
    setConnectSeen(true);
    setConnectAgain(false);
  };
  const showConnect = connectAgain || (!connectSeen && plan.step === "describe");
  const sheetStep = showConnect ? 0 : plan.step === "describe" ? 1 : 2;
  const steps = [
    { label: "Connect", go: () => setConnectAgain(true) },
    {
      label: "Your app",
      go: () => {
        finishConnect();
        dispatch({ type: "goTo", step: "describe" });
      },
    },
    {
      label: "Questions",
      go: () => {
        finishConnect();
        dispatch({ type: "goTo", step: "confirm" });
      },
    },
  ];
  const mod = isMac() ? "⌘" : "Ctrl+";

  // A different part or connection starts at the top of its panel, not where the last one was scrolled.
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    drawerRef.current?.scrollTo({ top: 0 });
  }, [selectedSlot, connection]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((status: AiStatus) => setAi(status))
      .catch(() => setAi({ ai: false, model: "" }));
  }, []);

  /**
   * `stackwise` run in a project folder opens #open=<folder>. The folder's own plan file wins; then
   * a plan already linked to that folder; otherwise a new plan named after it, linked, with the
   * framework StackWise recognizes in it.
   */
  const openedFolder = useRef<string | null>(null);
  useEffect(() => {
    const match = window.location.hash.match(/^#open=(.+)$/);
    if (!match) return;
    const folder = decodeURIComponent(match[1]);
    if (openedFolder.current === folder) return;
    openedFolder.current = folder;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const call = (body: Record<string, unknown>) => fetch("/api/project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: folder, ...body }) }).then(async (r) => ({ ok: r.ok, body: await r.json() }));
    void (async () => {
      const name = folder.replace(/\/+$/, "").split("/").pop() || "app";
      const [planFile, project] = await Promise.all([call({ action: "planfile" }).catch(() => null), call({ action: "inspect" }).catch(() => null)]);
      if (!project?.ok) {
        setToast(project?.body?.error ?? `Couldn't open ${folder}.`);
        return;
      }
      const home: string = project.body.home ?? "";
      const absolute = (p: string) => p.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "");
      const plans = history.store.plans;
      const linked = Object.values(plans).find((p) => p.folder && absolute(p.folder) === absolute(project.body.folder));
      if (planFile?.ok && planFile.body.plan) {
        const { id, plan: shared } = planFile.body as { id: string; plan: SharedPlan };
        if (plans[id]) {
          dispatch({ type: "switchPlan", id });
          dispatch({ type: "applyRemote", id, plan: shared });
        } else dispatch({ type: "importPlan", id, now: new Date().toISOString(), plan: shared });
        dispatch({ type: "setFolder", folder: project.body.folder });
        setToast(`Opened ${shared.appName || name} from its whystack.plan.json.`);
      } else if (linked) {
        dispatch({ type: "switchPlan", id: linked.id });
        setToast(`Opened ${linked.appName || name}, already linked to ${folder}.`);
      } else {
        dispatch({ type: "newPlan", id: newId(), now: new Date().toISOString() });
        dispatch({ type: "setText", field: "appName", value: name });
        if (project.body.readme) dispatch({ type: "setText", field: "description", value: project.body.readme });
        dispatch({ type: "setFolder", folder: project.body.folder });
        if (project.body.framework) dispatch({ type: "place", slot: "framework", optionId: project.body.framework });
        setToast(`Started a plan for ${name}, linked to its folder${project.body.framework ? `, built with ${project.body.label}` : ""}${project.body.readme ? ". Its README is the description: check it and read it" : ""}.`);
      }
      setPanel("project");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per folder in the address
  }, []);

  // Opening a share link imports the plan exactly once. The link is cleared from the address bar
  // before decoding, and the token is remembered, because development mode runs effects twice.
  const importedToken = useRef<string | null>(null);
  useEffect(() => {
    // A link can also name the project folder on this computer (&folder=~/Projects/app), so opening it links the project too.
    const match = window.location.hash.match(/^#plan=([A-Za-z0-9_-]+)(?:&folder=([^&]+))?$/);
    if (!match || importedToken.current === match[1]) return;
    const folder = match[2] ? decodeURIComponent(match[2]) : null;
    importedToken.current = match[1];
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void decodeSharedPlan(match[1]).then((shared) => {
      if (!shared) {
        setToast("That share link is broken or incomplete.");
        return;
      }
      dispatch({ type: "importPlan", id: newId(), now: new Date().toISOString(), plan: shared });
      if (folder) dispatch({ type: "setFolder", folder });
      setToast(`Opened "${shared.appName || "a shared plan"}". It's saved as a new plan in this browser.`);
    });
  }, [dispatch]);

  const select = useCallback((slot: SlotId) => {
    setSelectedSlot(slot);
    setConnection(null);
  }, []);
  const selectConnection = useCallback((slot: SlotId) => {
    setSelectedSlot(slot);
    setConnection(slot);
  }, []);
  const deselect = useCallback(() => {
    setSelectedSlot(null);
    setConnection(null);
  }, []);
  const openAsk = useCallback((slot: SlotId, question?: string) => {
    setAsk({ open: true, slot, request: question ? { slot, question, nonce: Date.now() } : null });
  }, []);
  const openAdd = useCallback((slot?: SlotId) => setAdding({ focus: slot ?? null }), []);

  /**
   * Taking a part out. A part the answers don't need goes away; one they do need is emptied, and
   * stays on the canvas as "choose one" until the answer changes, because the plan can't work without it.
   */
  const removePart = useCallback(
    (slot: SlotId) => {
      if (slot === "framework") return;
      const name = rec.selection[slot] ? (index.optionsById.get(rec.selection[slot]!)?.name ?? slot) : (index.slotsById.get(slot)?.label ?? slot);
      const needed = rec.needed.includes(slot);
      dispatch(needed ? { type: "clearSlot", slot } : { type: "autoPick", slot });
      if (selectedSlot === slot) {
        setSelectedSlot(null);
        setConnection(null);
      }
      setToast(needed ? `Took out ${name}. Your answers still need ${index.slotsById.get(slot)?.label.toLowerCase()}, so pick another or change the answer. Undo puts it back.` : `Removed ${name}. Undo puts it back.`);
    },
    [rec.selection, rec.needed, index, dispatch, selectedSlot],
  );

  const togglePanel = (next: Panel) => setPanel((current) => (current === next ? null : next));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAsk((a) => ({ ...a, open: !a.open, request: null }));
        return;
      }
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]");
      const busy = Boolean(document.querySelector("dialog[open], .ws-add, .ws-cmenu-root"));
      if (!typing && !busy && !mod && !e.altKey && plan.step === "plan") {
        if (e.key.toLowerCase() === "a") {
          e.preventDefault();
          openAdd(selectedSlot ?? undefined);
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && selectedSlot && selectedSlot !== "framework") {
          e.preventDefault();
          removePart(selectedSlot);
          return;
        }
      }
      if (e.key === "Escape" && !typing && !document.querySelector("dialog[open]")) {
        if (panel) setPanel(null);
        else if (selectedSlot) deselect();
        return;
      }
      if (typing || !mod || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      dispatch({ type: e.shiftKey ? "redo" : "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, panel, selectedSlot, deselect, openAdd, removePart, plan.step]);

  const nameOf = useCallback(
    (slot: SlotId) => {
      const id = rec.selection[slot];
      if (slot === "framework") return plan.appName.trim() || "your app";
      return id ? (index.optionsById.get(id)?.name ?? id) : (index.slotsById.get(slot)?.label ?? slot);
    },
    [rec.selection, index, plan.appName],
  );

  /** Right-click menus, built here because they reach every panel and action in the workspace. */
  const openMenu = useCallback(
    (target: CanvasTarget, x: number, y: number) => {
      const undoRedo: MenuItem[] = [
        { label: "Undo", icon: "undo", hint: `${mod}Z`, disabled: history.past.length === 0, onSelect: () => dispatch({ type: "undo" }) },
        { label: "Redo", icon: "redo", hint: `⇧${mod}Z`, disabled: history.future.length === 0, onSelect: () => dispatch({ type: "redo" }) },
      ];
      let items: MenuItem[];

      if (target.kind === "part") {
        const { slot } = target;
        const def = index.slotsById.get(slot)!;
        const current = rec.selection[slot];
        const choices = catalog.options.filter((o) => o.slots.includes(slot));
        const hasWire = slot !== "framework" && Boolean(current);
        const needed = rec.needed.includes(slot);
        items = [
          { kind: "header", label: current ? `${def.label}: ${nameOf(slot)}` : def.label },
          { label: "Ask about this", icon: "sparkle", onSelect: () => openAsk(slot) },
          { label: "Show details", icon: "info", onSelect: () => select(slot) },
          ...(hasWire ? [{ label: "Show the connection", icon: "link" as const, onSelect: () => selectConnection(slot) }] : []),
          { kind: "separator" },
          {
            kind: "submenu",
            label: current ? "Swap for" : "Choose",
            icon: "swap",
            disabled: choices.length === 0,
            items: choices.map((o) => ({
              label: o.name,
              lead: <Logo logo={catalog.logos[o.id]} name={o.name} size={16} />,
              checked: o.id === current,
              onSelect: () => {
                if (o.id === current) return;
                const error = model.place(o.id, slot);
                setToast(error ?? `Switched ${def.label.toLowerCase()} to ${o.name}. Undo reverses it.`);
              },
            })),
          },
          ...(slot !== "framework" && needed && !rec.autoPicked.includes(slot) ? [{ label: "Let StackWise pick", icon: "wand" as const, onSelect: () => dispatch({ type: "autoPick", slot }) }] : []),
          ...(slot === "framework"
            ? [{ label: plan.icon ? "Change the app's logo" : "Add a logo for this app", icon: "pin" as const, onSelect: () => setPanel("project") }]
            : []),
          {
            label: `${def.label} in Learn`,
            icon: "learn",
            onSelect: () => {
              setLearnFocus(slot);
              setPanel("learn");
            },
          },
          ...(slot !== "framework" && current
            ? [
                { kind: "separator" as const },
                { label: "Remove", icon: "trash" as const, hint: "Delete", danger: true, onSelect: () => removePart(slot) },
              ]
            : []),
        ];
      } else if (target.kind === "connection") {
        const { slot } = target;
        const wire = connectionsOf(index, rec.selection).find((c) => c.slot === slot);
        const carried = wire ? (wire.everything ? planEnv(index, rec.selection) : wire.env) : [];
        items = [
          { kind: "header", label: `Your app and ${nameOf(slot)}` },
          { label: "Explain this connection", icon: "sparkle", onSelect: () => openAsk(slot, `What travels between my app and ${nameOf(slot)}, and what could go wrong with it?`) },
          { label: "What travels along it", icon: "link", onSelect: () => selectConnection(slot) },
          {
            label: `Copy ${carried.length} variable name${carried.length === 1 ? "" : "s"} for .env.local`,
            icon: "note",
            disabled: carried.length === 0,
            onSelect: async () => {
              const text = envFileText(carried, { appName: plan.appName, generatedOn: today });
              setToast((await copyText(text)) ? "Copied. Paste into .env.local and fill in the values." : "Couldn't copy to the clipboard.");
            },
          },
          { kind: "separator" },
          { label: `${nameOf(slot)} details`, icon: "info", onSelect: () => select(slot) },
        ];
      } else if (target.kind === "pair") {
        const { slot, other } = target;
        items = [
          { kind: "header", label: `${nameOf(other)} and ${nameOf(slot)}` },
          { label: "Explain the problem", icon: "sparkle", onSelect: () => openAsk(slot, `What is the problem between ${nameOf(other)} and ${nameOf(slot)}, and how do I fix it?`) },
          { kind: "separator" },
          { label: `${nameOf(other)} details`, icon: "info", onSelect: () => select(other) },
          { label: `${nameOf(slot)} details`, icon: "info", onSelect: () => select(slot) },
        ];
      } else {
        const moved = Object.keys(plan.layout).length > 0;
        items = [
          { label: "Ask about the whole plan", icon: "sparkle", hint: `${mod}K`, onSelect: () => openAsk("framework") },
          { label: "Explain my plan", icon: "overview", disabled: !building, onSelect: () => openAsk("framework", "Explain my plan") },
          { kind: "separator" },
          { label: "Add a part", icon: "plus", hint: "A", onSelect: () => openAdd() },
          { label: showAll ? "Hide optional parts" : `Show all ${HIDEABLE_PARTS} parts`, icon: "parts", checked: showAll, onSelect: () => setShowAll((v) => !v) },
          {
            label: "Fit to screen",
            icon: "target",
            onSelect: () => setFitNonce((n) => n + 1),
          },
          {
            label: "Tidy up",
            icon: "fit",
            disabled: !moved,
            onSelect: () => {
              dispatch({ type: "moveNodes", spots: tidySpots(visibleParts(rec.selection, rec.needed, showAll), plan.layout) });
              setFitNonce((n) => n + 1);
            },
          },
          { kind: "separator" },
          ...undoRedo,
          { kind: "separator" },
          { label: "Edit answers", icon: "checklist", onSelect: () => dispatch({ type: "goTo", step: "confirm" }) },
          { label: "Export project", icon: "export", disabled: !building, onSelect: () => setSpecDate(todayIso()) },
        ];
      }
      setMenu({ x, y, items });
    },
    [mod, history, dispatch, index, rec, catalog, nameOf, openAsk, openAdd, removePart, select, selectConnection, model, plan.appName, plan.layout, plan.icon, today, building, showAll],
  );

  const researched = catalog.options.filter((o) => o.coverage === "full").length;
  const factCount = catalog.options.reduce((n, o) => n + Object.keys(o.facts).length, 0);
  const verified = catalog.options.reduce((n, o) => n + Object.values(o.facts).filter((f) => f.status === "verified").length, 0);

  return (
    <div className={cx("ws", !building && "is-planning")} data-drawer={selectedSlot ? "open" : "closed"} data-panel={panel ?? "none"}>
      <ReactFlowProvider>
        <PlanCanvas
          model={model}
          selectedSlot={selectedSlot}
          selectedConnection={connection}
          dragging={dragging}
          showAll={showAll}
          fitNonce={fitNonce}
          onDropped={() => setDragging(null)}
          onSelect={select}
          onSelectConnection={selectConnection}
          onDeselect={deselect}
          onAsk={openAsk}
          onMenu={openMenu}
          onAdd={openAdd}
          onRemove={removePart}
          onToast={setToast}
        />
      </ReactFlowProvider>

      <header className="ws-bar">
        <div className="ws-bar__side">
          <span className="ws-mark">
            <BrandMark size={22} />
            <span className="ws-mark__name">StackWise</span>
          </span>
          <PlanMenu model={model} onToast={setToast} />
        </div>
        {building && <SummaryPill model={model} onOpen={() => setPanel("overview")} />}
        <div className="ws-bar__side ws-bar__side--end">
          <button
            type="button"
            className={cx("ws-connpill", connectOpen && "is-on")}
            aria-expanded={connectOpen}
            title={`${answerer.label}: ${STATE_TEXT[answerer.state].toLowerCase()}. Click to change what's connected.`}
            onClick={() => setConnectOpen((v) => !v)}
          >
            <span className={cx("ws-status-dot", live(answerer) && "is-on", answerer.state === "stopped" && "is-warn")} aria-hidden />
            <span className="ws-connpill__label">{answerer.id === "facts" ? "No AI connected" : answerer.label.replace(/ \(.*\)$/, "")}</span>
            {answerer.group === "agent" && <span className="ws-connpill__state">{STATE_TEXT[answerer.state]}</span>}
          </button>
          <button type="button" className={cx("ws-askbtn", ask.open && "is-on")} onClick={() => setAsk((a) => ({ ...a, open: !a.open, request: null }))} title={`Ask about your plan (${mod}K)`}>
            <Icon name="sparkle" size={15} />
            <span>Ask</span>
            <kbd>{mod}K</kbd>
            {listening && <span className="ws-status-dot is-on" title={`${listening} is listening`} />}
          </button>
          <button type="button" className="mk-btn mk-btn--primary mk-sm" disabled={!building} onClick={() => setSpecDate(todayIso())}>
            <Icon name="export" size={14} /> Export
          </button>
        </div>
      </header>

      {problems.length > 0 && (
        <div className="ws-problems" role="alert">
          The data has {problems.length} problem{problems.length === 1 ? "" : "s"}. Run <code>pnpm check:data</code>. First: {problems[0]}
        </div>
      )}

      {building && (
        <nav className="ws-dock" aria-label="Panels">
          <button type="button" className="ws-dock__btn ws-dock__add" title="Add a part (A)" onClick={() => openAdd()}>
            <Icon name="plus" size={16} />
            <span>Add</span>
          </button>
          <span className="ws-dock__sep" aria-hidden />
          {PANELS.map((p) => (
            <button key={p.id} type="button" className={cx("ws-dock__btn", panel === p.id && "is-on")} aria-pressed={panel === p.id} onClick={() => togglePanel(p.id)}>
              <Icon name={p.icon} size={16} />
              <span>{p.label}</span>
            </button>
          ))}
          <span className="ws-dock__sep" aria-hidden />
          <button type="button" className="ws-dock__btn ws-dock__btn--icon" disabled={history.past.length === 0} title={`Undo (${mod}Z)`} aria-label="Undo" onClick={() => dispatch({ type: "undo" })}>
            <Icon name="undo" size={16} />
          </button>
          <button type="button" className="ws-dock__btn ws-dock__btn--icon" disabled={history.future.length === 0} title={`Redo (⇧${mod}Z)`} aria-label="Redo" onClick={() => dispatch({ type: "redo" })}>
            <Icon name="redo" size={16} />
          </button>
          <button type="button" className="ws-dock__btn ws-dock__btn--icon" title="Fit to screen" aria-label="Fit to screen" onClick={() => setFitNonce((n) => n + 1)}>
            <Icon name="fit" size={16} />
          </button>
        </nav>
      )}

      {building && panel && (
        <aside className="ws-float ws-float--left" aria-label={PANELS.find((p) => p.id === panel)?.label}>
          <div className="ws-float__head">
            <h2>{PANELS.find((p) => p.id === panel)?.label}</h2>
            <button type="button" className="ws-iconbtn" aria-label="Close" onClick={() => setPanel(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="ws-float__body">
            {panel === "overview" && (
              <>
                <Overview model={model} onSelect={select} onOpenChecklist={() => setPanel("checklist")} onExplain={() => openAsk("framework", "Explain my plan")} />
                <p className="mk-hint ws-float__foot" title="Facts come from official sources and are drafts until a person reviews them.">
                  {verified} of {factCount} facts reviewed, {researched} of {catalog.options.length} options researched{stale ? `, ${stale} may be out of date` : ""}.
                </p>
              </>
            )}
            {panel === "project" && <ProjectPanel model={model} pairing={pairing} onToast={setToast} />}
            {panel === "options" && <Palette model={model} selectedSlot={selectedSlot} onDragStart={setDragging} onDragEnd={() => setDragging(null)} onToast={setToast} />}
            {panel === "checklist" && <ChecklistPanel model={model} today={today} onToast={setToast} />}
            {panel === "learn" && <LearnPanel catalog={catalog} focus={learnFocus ?? selectedSlot} />}
          </div>
        </aside>
      )}

      {selectedSlot && (
        <aside className="ws-float ws-float--right" aria-label={connection ? "Connection" : "Details"}>
          <div className="ws-float__head">
            <h2>{connection ? "Connection" : "Details"}</h2>
            <button type="button" className="ws-iconbtn" aria-label="Close" title="Close (Esc)" onClick={deselect}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="ws-float__body" ref={drawerRef}>
            {connection ? (
              <ConnectionPanel
                model={model}
                slot={connection}
                today={today}
                onAsk={openAsk}
                onShowPart={() => setConnection(null)}
                onOpenChecklist={() => setPanel("checklist")}
                onToast={setToast}
              />
            ) : (
              <Inspector
                model={model}
                slot={selectedSlot}
                today={today}
                onAsk={openAsk}
                onToast={setToast}
                onCompare={(slot, optionIds) => setCompare({ slot, optionIds })}
                onLearn={() => {
                  setLearnFocus(selectedSlot);
                  setPanel("learn");
                }}
              />
            )}
          </div>
        </aside>
      )}

      {connectOpen && (
        <aside className="ws-float ws-float--connect" aria-label="Connect your AI">
          <div className="ws-float__head">
            <h2>Connection</h2>
            <button type="button" className="ws-iconbtn" aria-label="Close" onClick={() => setConnectOpen(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="ws-float__body">
            <ConnectPanel ai={ai} pairing={pairing} savedDefault={savedDefault} onChoose={chooseAnswerer} onToast={setToast} />
          </div>
        </aside>
      )}

      {!building && (
        <div className="ws-sheet-wrap">
          <div className="ws-sheet" role="dialog" aria-label={showConnect ? "Connect your AI" : "Describe your app"}>
            <nav className="ws-steps" aria-label="Steps">
              {steps.map((step, i) => (
                <button key={step.label} type="button" className={cx("ws-steps__step", i === sheetStep && "is-on", i < sheetStep && "is-done")} aria-current={i === sheetStep ? "step" : undefined} onClick={step.go}>
                  <span className="ws-steps__n">{i < sheetStep ? "\u2713" : i + 1}</span>
                  {step.label}
                </button>
              ))}
            </nav>
            {showConnect ? (
              <ConnectPanel ai={ai} pairing={pairing} savedDefault={savedDefault} onChoose={chooseAnswerer} onDone={finishConnect} onToast={setToast} />
            ) : (
              <Planner model={model} ai={ai} />
            )}
          </div>
        </div>
      )}

      {ask.open && (
        <AskPanel
          model={model}
          ai={ai}
          slot={ask.slot}
          request={ask.request}
          pairing={pairing}
          savedDefault={savedDefault}
          onSaveDefault={chooseAnswerer}
          onSlot={(slot) => setAsk((a) => ({ ...a, slot, request: null }))}
          onClose={() => setAsk((a) => ({ ...a, open: false, request: null }))}
          onToast={setToast}
        />
      )}

      {adding && (
        <AddPart
          model={model}
          focus={adding.focus}
          onClose={() => setAdding(null)}
          onAdded={(slot, name, error) => setToast(error ?? `Added ${name} to ${index.slotsById.get(slot)?.label.toLowerCase()}. Its line shows whether it works with the rest.`)}
        />
      )}

      <ContextMenu request={menu} onClose={() => setMenu(null)} />

      {toast && (
        <div className="ws-toast" role="status">
          {toast}
        </div>
      )}

      <SpecDialog model={model} generatedOn={specDate} whystackRoot={ai?.root} onClose={() => setSpecDate(null)} onToast={setToast} />
      <CompareDialog model={model} request={compare} today={today} onClose={() => setCompare(null)} onToast={setToast} />
    </div>
  );
}
