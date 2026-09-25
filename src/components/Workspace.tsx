"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { buildPlan, buildPlanMarkdown, connectionsOf, decodeSharedPlan, envFileText, inSentence, isOwn, LINK_WORDS, linkId, ownId, planEnv, SLOT_IDS, taskBrief, todayIso, type Catalog, type SharedPlan, type SlotId } from "@/engine";
import { presence } from "@/mcp/pairing";
import { AddPart } from "./AddPart";
import { AnswererMark } from "./AnswererMark";
import { BrandMark } from "./BrandMark";
import { AskPanel, type AskRequest } from "./AskPanel";
import { live, pickDefault, readDefaultAnswerer, recipientsFor, saveDefaultAnswerer, STATE_TEXT } from "./answerers";
import { ConnectPanel } from "./ConnectPanel";
import { ChecklistPanel } from "./ChecklistPanel";
import { CompareDialog, type CompareRequest } from "./CompareDialog";
import { ConnectionPanel } from "./ConnectionPanel";
import { ContextMenu, type MenuItem, type MenuRequest } from "./ContextMenu";
import { Icon, type IconName } from "./icons";
import { CustomPartDialog, type CustomEdit } from "./CustomPartDialog";
import { ExtraDialog, type ExtraEdit } from "./ExtraDialog";
import { LinkDialog, type LinkEdit } from "./LinkDialog";
import type { ImageRequest } from "./DiagramImage";
import { Inspector } from "./Inspector";
import { PanelEdge, usePanelWidth } from "./PanelEdge";
import { ThemeSwitch } from "./ThemeSwitch";
import { Palette } from "./Palette";
import { PlanCanvas, tidySpots, visibleParts, type CanvasTarget } from "./PlanCanvas";
import { PlanMenu } from "./PlanMenu";
import { ProjectPanel } from "./ProjectPanel";
import { Overview, Planner, SummaryPill, type AiStatus } from "./Planner";
import { SpecDialog } from "./SpecDialog";
import { usePairing, type ClaudeActivity } from "./usePairing";
import { newId, usePlans } from "./usePlans";
import { Logo, copyText, cx, undoHint } from "./ui";
import { sharedName } from "./planFiles";
import { Tip } from "./Tip";
import { migrateLegacyStorage } from "./storage";
import { useAdvanced } from "./useAdvanced";
import { HOSTED, SOURCE_URL } from "@/hosted";

/**
 * The workspace is the canvas, full screen, with everything else floating over it:
 *   - a bar on top: plans, the plan in one line, Ask and Export
 *   - a dock at the bottom: Overview, Parts, Checklist, Learn, undo and redo
 *   - one panel on the left from the dock, and Details on the right when something is picked
 *   - the Ask panel (Cmd+K), for talking to Claude or a paired coding agent
 *   - right-click menus on parts, lines and the canvas
 * Describing the app and confirming the guesses happen in a sheet over the canvas, which fills in
 * behind it as the answers change.
 *
 * The hosted copy (src/hosted.ts) has no Connect step, no agents and no project folder. Advanced
 * tools (useAdvanced) hide the ways to add extras, lines, your own parts and the Project panel
 * until someone turns them on; whatever a plan already has keeps its own menu either way.
 */

type Panel = "overview" | "project" | "options" | "checklist";
/**
 * The dock, in the order the work happens: see how the plan stands, change its parts, set them up,
 * then run the real project. Learn (its own page) and the canvas tools come after.
 */
const PANELS: { id: Panel; label: string; icon: IconName; hint: string }[] = [
  { id: "overview", label: "Overview", icon: "overview", hint: "Problems, close calls, accounts and cost." },
  { id: "options", label: "Parts", icon: "parts", hint: "Every service StackWise knows, by part. Drag one onto the canvas." },
  { id: "checklist", label: "Checklist", icon: "checklist", hint: "Accounts, keys and the build order, to tick off." },
  { id: "project", label: "Project", icon: "terminal", hint: "Your project folder: run it, set its keys, test each service." },
];

// Saved data from before StackWise's rename moves to its new keys before anything reads it.
if (typeof window !== "undefined") migrateLegacyStorage();

/** The side panels' widths until someone drags their edge (PanelEdge). */
const LEFT_WIDTH = 360;
const RIGHT_WIDTH = 380;

const CONNECT_SEEN_KEY = "stackwise.connect-seen";
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
  const router = useRouter();
  /** Learn is its own page; a part opens at its section there. The plan waits in this browser. */
  const openLearn = useCallback((slot?: SlotId | null) => router.push(`/learn${slot ? `#part-${slot}` : ""}`), [router]);
  const { plan, dispatch, history, rec, index } = model;
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(null);
  /** The part at the far end of the connection being looked at, when one is. */
  const [connection, setConnection] = useState<SlotId | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [ask, setAsk] = useState<{ open: boolean; slot: SlotId; request: AskRequest | null }>({ open: false, slot: "framework", request: null });
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [image, setImage] = useState<ImageRequest | null>(null);
  const saveImage = useCallback((transparent: boolean) => setImage((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, transparent })), []);
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
  const [customEdit, setCustomEdit] = useState<CustomEdit | null>(null);
  const [extraEdit, setExtraEdit] = useState<ExtraEdit | null>(null);
  const [linkEdit, setLinkEdit] = useState<LinkEdit | null>(null);
  const [leftWidth, setLeftWidth] = usePanelWidth("left", LEFT_WIDTH);
  const [rightWidth, setRightWidth] = usePanelWidth("right", RIGHT_WIDTH);
  const [advanced, setAdvanced] = useAdvanced();
  /** The Project panel: only on your own computer, and once advanced tools are on or the plan already has a folder. */
  const projectPanel = !HOSTED && (advanced || Boolean(plan.folder));
  const panels = PANELS.filter((p) => p.id !== "project" || projectPanel);
  /** The open left panel, unless it's Project and advanced tools were just turned off. */
  const shown = panels.find((p) => p.id === panel) ?? null;

  const onClaudeChange = useCallback((appName: string, change: ClaudeActivity | undefined) => {
    const what = change ? `${change.summary}${change.changes.length ? `: ${change.changes.slice(0, 2).join("; ")}${change.changes.length > 2 ? ` (+${change.changes.length - 2})` : ""}` : ""}` : "updated the plan";
    setToast(`Your agent changed ${appName.trim() || "your plan"}. ${what}. ${undoHint()}`);
  }, []);
  const pairing = usePairing({ history, dispatch, onClaudeChange });
  const today = useMemo(() => todayIso(), []);
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
  // The hosted copy has nothing to connect: no terminal agents, and no keys of the visitor's.
  const showConnect = !HOSTED && (connectAgain || (!connectSeen && plan.step === "describe"));
  const sheetStep = showConnect ? 0 : (HOSTED ? 0 : 1) + (plan.step === "describe" ? 0 : 1);
  const steps = [
    ...(HOSTED ? [] : [{ label: "Connect", go: () => setConnectAgain(true) }]),
    {
      label: "Describe",
      go: () => {
        finishConnect();
        dispatch({ type: "goTo", step: "describe" });
      },
    },
    {
      label: "Confirm",
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

  /** A key saved from Connect: new providers, keeping what else the server said (its folder, the limit). */
  const updateAi = useCallback((next: AiStatus) => setAi((prev) => ({ ...prev, ...next })), []);

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
    if (!match || HOSTED) return;
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
        setToast(`Opened ${shared.appName || name} from its plan file.`);
      } else if (linked) {
        dispatch({ type: "switchPlan", id: linked.id });
        setToast(`Opened ${linked.appName || name}, already linked to ${folder}.`);
      } else {
        dispatch({ type: "newPlan", id: newId(), now: new Date().toISOString() });
        dispatch({ type: "setText", field: "appName", value: name });
        if (project.body.readme) dispatch({ type: "setText", field: "description", value: project.body.readme });
        dispatch({ type: "setFolder", folder: project.body.folder });
        if (project.body.framework) dispatch({ type: "place", slot: "framework", optionId: project.body.framework });
        setToast(`New application for ${name}, linked to its folder${project.body.framework ? `, built with ${project.body.label}` : ""}.${project.body.readme ? " Its README is the description: check it, then press Read my description." : ""}`);
      }
      setPanel("project");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per folder in the address
  }, []);

  // Opening a share link imports the plan exactly once. The link is cleared from the address bar
  // before decoding, and the token is remembered, because development mode runs effects twice.
  const importedToken = useRef<string | null>(null);
  useEffect(() => {
    // A link can also name a project folder on this computer (&folder=~/Projects/app). Linking one lets StackWise run and write
    // files there, so a link from someone else only links it after the person says yes.
    const match = window.location.hash.match(/^#plan=([A-Za-z0-9_-]+)(?:&folder=([^&]+))?$/);
    if (!match || importedToken.current === match[1]) return;
    const folder = match[2] && !HOSTED ? decodeURIComponent(match[2]) : null;
    importedToken.current = match[1];
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void decodeSharedPlan(match[1]).then((shared) => {
      if (!shared) {
        setToast("That share link is broken or incomplete.");
        return;
      }
      // Named like an application already here? The copy gets " (shared)" so the two can be told apart.
      const plan = sharedName(shared, history.store.plans);
      dispatch({ type: "importPlan", id: newId(), now: new Date().toISOString(), plan });
      if (folder && window.confirm(`This link also points at a folder on this computer:\n\n${folder}\n\nLink "${plan.appName || "this plan"}" to it? StackWise only runs or writes files there when you ask it to.`)) {
        dispatch({ type: "setFolder", folder });
      }
      setToast(`Opened "${plan.appName || "a shared plan"}". It's saved as a new application in this browser.`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per link; the names only matter at that moment
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
      setToast(needed ? `Removed ${name}. Your answers still need ${index.slotsById.get(slot)?.label.toLowerCase()}: pick another or change that answer. ${undoHint()}` : `Removed ${name}. ${undoHint()}`);
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

  /** A readable name for anything a line can join: the app, a part, an extra, a part added by hand. */
  const endName = useCallback(
    (end: string) => {
      if (end === "app") return plan.appName.trim() || "the app";
      const extra = plan.extras[end];
      if (extra) return `${index.optionsById.get(extra.option)?.name ?? extra.option} (${extra.role || end})`;
      if (plan.custom[end]) return plan.custom[end].name;
      return nameOf(end as SlotId);
    },
    [plan.appName, plan.extras, plan.custom, index, nameOf],
  );

  /** The canvas as ordered build tasks (buildplan.ts), for "Build this with" and "Copy the build plan". */
  const tasks = useMemo(() => buildPlan(index, model.input, rec.selection, plan), [index, model.input, rec.selection, plan]);
  /**
   * Who builds a task: the agent listening now, else the default answerer if it's an agent, else the
   * builder the plan names, else Claude Code. A message waits until that agent listens. None hosted.
   */
  const builderAgent = useMemo(() => {
    const agents = recipients.filter((r) => r.group === "agent");
    return (
      agents.find((r) => r.state === "listening" || r.state === "working") ??
      agents.find((r) => r.id === answerer.id) ??
      agents.find((r) => r.id === `agent:${plan.builderId}`) ??
      agents.find((r) => r.id === "agent:claude-code")
    );
  }, [recipients, answerer.id, plan.builderId]);
  /** "Build this with <agent>": sends one task, in full, to that agent through the Ask panel. */
  const buildWith = useCallback(
    (taskId: string): MenuItem[] => {
      const task = tasks.find((t) => t.id === taskId);
      if (!builderAgent || !building || !task) return [];
      return [
        {
          label: `Build this with ${builderAgent.label}`,
          icon: "terminal",
          onSelect: () => setAsk({ open: true, slot: task.slot, request: { slot: task.slot, question: taskBrief(tasks, taskId, plan.appName)!, nonce: Date.now(), to: builderAgent.id } }),
        },
      ];
    },
    [tasks, builderAgent, building, plan.appName],
  );

  /** "Draw a line to…": every other thing on the canvas a line from `from` could reach. */
  const drawLineMenu = useCallback(
    (from: string): MenuItem => {
      const ends = ["app", ...SLOT_IDS.filter((slot) => slot !== "framework" && rec.selection[slot]), ...Object.keys(plan.extras), ...Object.keys(plan.custom)].filter((end) => end !== from);
      return {
        kind: "submenu",
        label: "Draw a line to",
        icon: "link",
        disabled: ends.length === 0,
        items: ends.map((end) => ({
          label: endName(end),
          // The part each one fills, so PostHog for analytics and PostHog for monitoring can be told apart.
          hint: index.slotsById.get(end as SlotId)?.label,
          checked: Boolean(plan.links[linkId(from, end)]),
          onSelect: () => setLinkEdit({ from, to: end, saved: Boolean(plan.links[linkId(from, end)]) }),
        })),
      };
    },
    [rec.selection, plan.extras, plan.custom, plan.links, endName, index],
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
          { label: "Details", icon: "info", onSelect: () => select(slot) },
          ...(hasWire ? [{ label: "Connection", icon: "link" as const, onSelect: () => selectConnection(slot) }] : []),
          ...(current ? buildWith(`part:${slot}`) : []),
          { kind: "separator" },
          {
            kind: "submenu",
            label: current ? "Switch to" : "Pick",
            icon: "swap",
            disabled: choices.length === 0,
            items: choices.map((o) => ({
              label: o.name,
              lead: <Logo logo={catalog.logos[o.id]} name={o.name} size={16} />,
              checked: o.id === current,
              onSelect: () => {
                if (o.id === current) return;
                const error = model.place(o.id, slot);
                setToast(error ?? `Switched ${def.label.toLowerCase()} to ${o.name}. ${undoHint()}`);
              },
            })),
          },
          ...(advanced && slot !== "framework" && !isOwn(current)
            ? [
                {
                  label: "Build it yourself",
                  icon: "terminal" as const,
                  onSelect: () => {
                    model.place(ownId(slot), slot);
                    setToast(`${def.label} is now your own code. Describe it in its note. StackWise won't check or price it.`);
                  },
                },
              ]
            : []),
          ...(slot !== "framework" && needed && !rec.autoPicked.includes(slot) ? [{ label: "Let StackWise pick", icon: "wand" as const, onSelect: () => dispatch({ type: "autoPick", slot }) }] : []),
          // A second service in this part (a cache next to the database), and lines to other parts.
          ...(advanced && slot !== "framework" && current ? [{ label: `Add another service for ${def.label.toLowerCase()}`, icon: "plus" as const, onSelect: () => setExtraEdit({ id: null, slot }) }] : []),
          ...(advanced && current ? [drawLineMenu(slot === "framework" ? "app" : slot)] : []),
          ...(slot === "framework" && projectPanel
            ? [{ label: plan.icon ? "Change the app's logo" : "Add a logo for this app", icon: "pin" as const, onSelect: () => setPanel("project") }]
            : []),
          {
            label: `Learn about ${inSentence(def.label)}`,
            icon: "learn",
            onSelect: () => openLearn(slot),
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
          { label: "Environment variables", icon: "link", onSelect: () => selectConnection(slot) },
          ...(carried.length > 0
            ? [
                {
                  label: `Copy ${carried.length} variable name${carried.length === 1 ? "" : "s"} for .env.local`,
                  icon: "note" as const,
                  onSelect: async () => {
                    const text = envFileText(carried, { appName: plan.appName, generatedOn: today });
                    setToast((await copyText(text)) ? "Copied. Paste into .env.local and fill in the values." : "Couldn't copy.");
                  },
                },
              ]
            : []),
          { kind: "separator" },
          { label: `${nameOf(slot)} details`, icon: "info", onSelect: () => select(slot) },
          // Lines the person drew between the app and this part ride on this line; they're edited here.
          ...Object.values(plan.links)
            .filter((link) => (link.from === "app" && link.to === slot) || (link.to === "app" && link.from === slot))
            .map((link) => ({ label: `Edit: ${endName(link.from)} ${LINK_WORDS[link.kind]} ${endName(link.to)}`, icon: "link" as const, onSelect: () => setLinkEdit({ from: link.from, to: link.to, saved: true }) })),
        ];
      } else if (target.kind === "extra") {
        const extra = plan.extras[target.id];
        if (!extra) return;
        items = [
          { kind: "header", label: endName(target.id) },
          { label: "Edit", icon: "note", onSelect: () => setExtraEdit({ id: target.id, slot: extra.slot }) },
          ...buildWith(`extra:${target.id}`),
          drawLineMenu(target.id),
          { kind: "separator" },
          {
            label: "Remove",
            icon: "trash",
            danger: true,
            onSelect: () => {
              dispatch({ type: "removeExtra", id: target.id });
              setToast(`Removed ${endName(target.id)}. Undo brings it back.`);
            },
          },
        ];
      } else if (target.kind === "link") {
        const link = plan.links[target.id];
        if (!link) return;
        items = [
          { kind: "header", label: `${endName(link.from)} ${LINK_WORDS[link.kind]} ${endName(link.to)}` },
          { label: "Edit the line", icon: "note", onSelect: () => setLinkEdit({ from: link.from, to: link.to, saved: true }) },
          ...buildWith(`link:${target.id}`),
          {
            label: "Remove the line",
            icon: "trash",
            danger: true,
            onSelect: () => {
              dispatch({ type: "removeLink", id: target.id });
              setToast("Removed the line. Undo brings it back.");
            },
          },
        ];
      } else if (target.kind === "custom") {
        const part = plan.custom[target.id];
        if (!part) return;
        items = [
          { kind: "header", label: `${part.name}, added by you` },
          { label: "Edit", icon: "note", onSelect: () => setCustomEdit({ id: target.id }) },
          ...buildWith(`custom:${target.id}`),
          drawLineMenu(target.id),
          {
            label: "Remove",
            icon: "trash",
            danger: true,
            onSelect: () => {
              dispatch({ type: "removeCustom", id: target.id });
              setToast(`Removed ${part.name}. ${undoHint()}`);
            },
          },
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
          { label: "Ask about the plan", icon: "sparkle", hint: `${mod}K`, onSelect: () => openAsk("framework") },
          { label: "Explain my plan", icon: "overview", disabled: !building, onSelect: () => openAsk("framework", "Explain my plan") },
          { kind: "separator" },
          { label: "Add a part", icon: "plus", hint: "A", onSelect: () => openAdd() },
          ...(advanced ? [{ label: "Add a part that isn't listed", icon: "plus" as const, onSelect: () => setCustomEdit({ id: null }) }] : []),
          { label: showAll ? "Hide empty parts" : "Show empty parts", icon: "parts", checked: showAll, onSelect: () => setShowAll((v) => !v) },
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
              dispatch({ type: "moveNodes", spots: tidySpots(visibleParts(rec.selection, rec.needed, showAll), plan.layout, [...Object.keys(plan.extras).map((id) => `extra-${id}`), ...Object.keys(plan.custom)]) });
              setFitNonce((n) => n + 1);
            },
          },
          { kind: "separator" },
          ...undoRedo,
          { kind: "separator" },
          { label: "Edit answers", icon: "checklist", onSelect: () => dispatch({ type: "goTo", step: "confirm" }) },
          { label: "Export project", icon: "export", disabled: !building, onSelect: () => setSpecDate(todayIso()) },
          {
            label: "Copy the build plan",
            icon: "checklist",
            disabled: !building,
            onSelect: async () => {
              const text = buildPlanMarkdown(tasks, { appName: plan.appName, generatedOn: today, problems: rec.results.some((r) => r.level !== "info") });
              setToast((await copyText(text)) ? `Copied ${tasks.length} tasks in build order. Paste them into your builder's chat or TASKS.md.` : "Couldn't copy.");
            },
          },
          { label: "Save as PNG", icon: "export", disabled: !building, onSelect: () => saveImage(false) },
          { label: "Save as PNG (transparent)", icon: "export", disabled: !building, onSelect: () => saveImage(true) },
        ];
      }
      setMenu({ x, y, items });
    },
    [mod, history, dispatch, index, rec, catalog, nameOf, openAsk, openAdd, openLearn, saveImage, removePart, select, selectConnection, model, plan.appName, plan.layout, plan.icon, plan.custom, plan.extras, plan.links, drawLineMenu, endName, today, building, showAll, advanced, projectPanel, buildWith, tasks],
  );

  // The AI pill: who answers, and whether it's there. Nothing connected reads as an invitation.
  const answererLive = live(answerer);
  const answererName = answerer.id === "facts" ? "No AI" : answerer.label.replace(/ \(.*\)$/, "").replace(/ API$/, "");
  const answererState = answerer.id === "facts" ? "Connect" : answerer.group === "api" ? "Ready" : STATE_TEXT[answerer.state];

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
          image={image}
          onDropped={() => setDragging(null)}
          onSelect={select}
          onSelectConnection={selectConnection}
          onDeselect={deselect}
          onAsk={openAsk}
          onMenu={openMenu}
          onAdd={openAdd}
          onRemove={removePart}
          onEditCustom={(id) => setCustomEdit({ id })}
          onEditExtra={(id) => setExtraEdit({ id, slot: plan.extras[id]?.slot ?? "database" })}
          onEditLink={(id) => {
            const link = plan.links[id];
            if (link) setLinkEdit({ from: link.from, to: link.to, saved: true });
          }}
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
          {HOSTED ? (
            <a
              className="ws-connpill"
              href={`${SOURCE_URL}#run-it-on-your-computer`}
              target="_blank"
              rel="noreferrer"
              title="This copy keeps your plans in this browser and answers from StackWise's facts. Run StackWise on your computer to pair a coding agent, use your own AI key and write project files."
            >
              <span className="ws-status-dot" aria-hidden />
              <span className="ws-connpill__label">Online demo</span>
              <span className="ws-connpill__state is-cta">Run it yourself</span>
            </a>
          ) : (
            <button
              type="button"
              className={cx("ws-connpill", connectOpen && "is-on", answererLive && "is-live")}
              aria-expanded={connectOpen}
              aria-label={`AI: ${answererName}, ${answererState.toLowerCase()}. Change it.`}
              title={answerer.id === "facts" ? "No AI is connected. StackWise answers from its own facts. Click to connect one." : `${answerer.label}: ${answererState.toLowerCase()}. Click to change.`}
              onClick={() => setConnectOpen((v) => !v)}
            >
              <span className={cx("ws-status-dot", answererLive && "is-on", answerer.state === "stopped" && "is-warn")} aria-hidden />
              {answerer.id !== "facts" && <AnswererMark id={answerer.id} className="ws-menu-logo" />}
              <span className="ws-connpill__label">{answererName}</span>
              <span className={cx("ws-connpill__state", answererLive && "is-live", answerer.id === "facts" && "is-cta")}>{answererState}</span>
            </button>
          )}
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
          <Tip name="Add" keys="A" text="Add a service to your plan.">
            <button type="button" className="ws-dock__btn ws-dock__add" aria-label="Add a part" onClick={() => openAdd()}>
              <Icon name="plus" size={16} />
              <span>Add</span>
            </button>
          </Tip>
          <span className="ws-dock__sep" aria-hidden />
          {panels.map((p) => (
            <Tip key={p.id} name={p.label} text={p.hint}>
              <button type="button" className={cx("ws-dock__btn", panel === p.id && "is-on")} aria-pressed={panel === p.id} onClick={() => togglePanel(p.id)}>
                <Icon name={p.icon} size={16} />
                <span>{p.label}</span>
              </button>
            </Tip>
          ))}
          <span className="ws-dock__sep" aria-hidden />
          <Tip name="Learn" text="What each part of an app does, in plain words.">
            <a className="ws-dock__btn" href="/learn">
              <Icon name="learn" size={16} />
              <span>Learn</span>
            </a>
          </Tip>
          <span className="ws-dock__sep" aria-hidden />
          <Tip name="Undo" keys={`${mod}Z`} text="Take back the last change to the plan.">
            <button type="button" className="ws-dock__btn ws-dock__btn--icon" disabled={history.past.length === 0} aria-label="Undo" onClick={() => dispatch({ type: "undo" })}>
              <Icon name="undo" size={16} />
            </button>
          </Tip>
          <Tip name="Redo" keys={`\u21e7${mod}Z`} text="Put back what you just undid.">
            <button type="button" className="ws-dock__btn ws-dock__btn--icon" disabled={history.future.length === 0} aria-label="Redo" onClick={() => dispatch({ type: "redo" })}>
              <Icon name="redo" size={16} />
            </button>
          </Tip>
          <Tip name="Fit" text="Zoom to show every part.">
            <button type="button" className="ws-dock__btn ws-dock__btn--icon" aria-label="Fit to screen" onClick={() => setFitNonce((n) => n + 1)}>
              <Icon name="fit" size={16} />
            </button>
          </Tip>
          <Tip name={advanced ? "Advanced tools: on" : "Advanced tools: off"} text={`A second service in one part, lines between parts, parts you build yourself${HOSTED ? "" : " and the Project panel"}. Click to turn them ${advanced ? "off" : "on"}.`}>
            <button type="button" className={cx("ws-dock__btn ws-dock__btn--icon", advanced && "is-on")} aria-pressed={advanced} aria-label="Advanced tools" onClick={() => setAdvanced(!advanced)}>
              <Icon name="tool" size={16} />
            </button>
          </Tip>
          <ThemeSwitch className="ws-dock__btn ws-dock__btn--icon" tip />
        </nav>
      )}

      {building && shown && (
        <aside className="ws-float ws-float--left" style={{ "--ws-panel-w": `${leftWidth}px` } as CSSProperties} aria-label={shown.label}>
          <PanelEdge side="left" width={leftWidth} fallback={LEFT_WIDTH} onResize={setLeftWidth} />
          <div className="ws-float__head">
            <h2>{shown.label}</h2>
            <button type="button" className="ws-iconbtn" aria-label="Close" onClick={() => setPanel(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="ws-float__body">
            {shown.id === "overview" && (
              <>
                <Overview model={model} onSelect={select} onOpenChecklist={() => setPanel("checklist")} onExplain={() => openAsk("framework", "Explain my plan")} />
              </>
            )}
            {shown.id === "project" && <ProjectPanel model={model} pairing={pairing} onToast={setToast} />}
            {shown.id === "options" && <Palette model={model} selectedSlot={selectedSlot} onDragStart={setDragging} onDragEnd={() => setDragging(null)} onToast={setToast} />}
            {shown.id === "checklist" && <ChecklistPanel model={model} today={today} onToast={setToast} onOpenProject={projectPanel ? () => setPanel("project") : undefined} />}
          </div>
        </aside>
      )}

      {selectedSlot && (
        <aside className="ws-float ws-float--right" style={{ "--ws-panel-w": `${rightWidth}px` } as CSSProperties} aria-label={connection ? "Connection" : "Details"}>
          <PanelEdge side="right" width={rightWidth} fallback={RIGHT_WIDTH} onResize={setRightWidth} />
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
                onLearn={() => openLearn(selectedSlot)}
                advanced={advanced}
              />
            )}
          </div>
        </aside>
      )}

      {connectOpen && (
        <aside className="ws-float ws-float--connect" aria-label="Connect an AI">
          <div className="ws-float__head">
            <h2>AI</h2>
            <button type="button" className="ws-iconbtn" aria-label="Close" onClick={() => setConnectOpen(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="ws-float__body">
            <ConnectPanel ai={ai} pairing={pairing} savedDefault={savedDefault} onChoose={chooseAnswerer} onKeysChanged={updateAi} onToast={setToast} />
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
              <ConnectPanel ai={ai} pairing={pairing} savedDefault={savedDefault} onChoose={chooseAnswerer} onKeysChanged={updateAi} onDone={finishConnect} onToast={setToast} />
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
          advanced={advanced}
          onClose={() => setAdding(null)}
          onAddOwn={(name) => {
            setAdding(null);
            setCustomEdit({ id: null, name });
          }}
          onAdded={(slot, name, error) =>
            setToast(
              error ??
                (name.startsWith("your own")
                  ? `${index.slotsById.get(slot)?.label} is now your own code. Describe it in its note. StackWise won't check or price it.`
                  : `Added ${name} to ${index.slotsById.get(slot)?.label.toLowerCase()}.`),
            )
          }
        />
      )}

      <ContextMenu request={menu} onClose={() => setMenu(null)} />

      <ExtraDialog
        edit={extraEdit}
        model={model}
        onClose={() => setExtraEdit(null)}
        onSave={(id, extra, previousId) => {
          dispatch({ type: "setExtra", id, extra });
          setExtraEdit(null);
          setToast(previousId ? `Saved ${endName(id)}.` : `Added ${endName(id)}. StackWise checks it and adds its cost like any other part.`);
        }}
        onRemove={(id) => {
          dispatch({ type: "removeExtra", id });
          setExtraEdit(null);
          setToast("Removed it. Undo brings it back.");
        }}
      />

      <LinkDialog
        edit={linkEdit}
        model={model}
        nameOf={endName}
        onClose={() => setLinkEdit(null)}
        onSave={(previousId, link) => {
          const id = linkId(link.from, link.to);
          if (previousId && previousId !== id) dispatch({ type: "removeLink", id: previousId });
          dispatch({ type: "setLink", id, link });
          setLinkEdit(null);
          setToast(`${endName(link.from)} ${LINK_WORDS[link.kind]} ${endName(link.to)}.`);
        }}
        onRemove={(id) => {
          dispatch({ type: "removeLink", id });
          setLinkEdit(null);
          setToast("Removed the line. Undo brings it back.");
        }}
      />

      <CustomPartDialog
        edit={customEdit}
        custom={plan.custom}
        onClose={() => setCustomEdit(null)}
        onSave={(id, part) => {
          const isNew = !plan.custom[id];
          dispatch({ type: "setCustom", id, part });
          setCustomEdit(null);
          setToast(isNew ? `Added ${part.name}. StackWise has no facts on it, so it isn't checked or priced.` : `Saved ${part.name}.`);
        }}
        onRemove={(id) => {
          const name = plan.custom[id]?.name ?? "the part";
          dispatch({ type: "removeCustom", id });
          setCustomEdit(null);
          setToast(`Removed ${name}. ${undoHint()}`);
        }}
      />

      {toast && (
        <div className="ws-toast" role="status">
          {toast}
        </div>
      )}

      <SpecDialog model={model} generatedOn={specDate} stackwiseRoot={ai?.root} onClose={() => setSpecDate(null)} onToast={setToast} onSaveImage={saveImage} />
      <CompareDialog model={model} request={compare} today={today} onClose={() => setCompare(null)} onToast={setToast} />
    </div>
  );
}
