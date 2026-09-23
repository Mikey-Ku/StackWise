"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  useInternalNode,
  useReactFlow,
  useStore,
  type Edge,
  type NodeChange,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { connectionLabel, connectionsOf, inSentence, optionStats, planEnv, worstLevel, type CheckResult, type Connection, type Logo as LogoFile, type SlotId } from "@/engine";
import { Icon } from "./icons";
import type { Spot } from "./store";
import type { PlanModel } from "./usePlans";
import { Logo, VERDICT_UI, VerdictDot, cx, type Verdict } from "./ui";
import { arrangeInOrder, wireEnds, type Box } from "./wire";

/**
 * The canvas is a graph with typed connections (see docs/DECISIONS.md), shown as one app in the
 * middle with the parts of the stack around it. Every connection has exactly one meaning, so every
 * one can be checked, and every one carries the environment variables that travel along it.
 *
 * Cards stay small on purpose: a logo, a name and a verdict dot. Everything else is one click
 * (Details), one right-click (the menu the workspace builds), or one double-click (Ask) away.
 * Parts can be dragged anywhere; where they're put is saved with the plan until it's tidied up.
 * Parts the plan doesn't need stay hidden until they're filled, "show all parts" is on, or someone
 * drags an option that fits one.
 */

type OuterSlot = Exclude<SlotId, "framework">;
/** Clockwise from the top. Parts that often get a line between them (hosting and database, login and email, email and domain) sit side by side. */
const OUTER: OuterSlot[] = ["hosting", "database", "login", "email", "domain", "files", "payments", "ai", "mobile", "jobs", "analytics", "monitoring", "scraping", "data_apis", "automations"];
export const HIDEABLE_PARTS = OUTER.length;

const APP_NODE = "app";
const nodeId = (slot: SlotId) => (slot === "framework" ? APP_NODE : `slot-${slot}`);

/** What a right-click landed on. The workspace turns it into menu items. */
export type CanvasTarget = { kind: "part"; slot: SlotId } | { kind: "connection"; slot: SlotId } | { kind: "pair"; slot: SlotId; other: SlotId } | { kind: "canvas" };

/**
 * Where StackWise puts the parts when nobody has moved them: on an ellipse around the app,
 * clockwise from the top, spaced evenly among the ones showing, so a small plan is as balanced as
 * a big one. The ellipse grows with the number of parts so cards don't overlap.
 */
function ellipseFor(count: number): { rx: number; ry: number } {
  const rx = Math.min(560, Math.max(320, 250 + count * 24));
  return { rx, ry: Math.round(rx * 0.72) };
}

function autoLayout(visible: OuterSlot[]): Record<string, Spot> {
  const { rx, ry } = ellipseFor(visible.length);
  return Object.fromEntries([
    [APP_NODE, { x: 0, y: 0 }],
    ...visible.map((slot, i) => {
      const angle = ((-90 + (i * 360) / visible.length) * Math.PI) / 180;
      return [nodeId(slot), { x: Math.round(rx * Math.cos(angle)), y: Math.round(ry * Math.sin(angle)) }];
    }),
  ]);
}

/** The parts showing on the canvas: filled, needed by the answers, or everything when "show all" is on. */
export function visibleParts(selection: Partial<Record<SlotId, string>>, needed: SlotId[], showAll: boolean): OuterSlot[] {
  return OUTER.filter((slot) => Boolean(selection[slot]) || needed.includes(slot) || showAll);
}

/** Spots for "Tidy up": every showing part keeps its place in the order around the app, evenly spaced. */
export function tidySpots(visible: OuterSlot[], layout: Record<string, Spot>): Record<string, Spot> {
  const auto = autoLayout(visible);
  const center = layout[APP_NODE] ?? auto[APP_NODE];
  const { rx, ry } = ellipseFor(visible.length);
  const parts = visible.map((slot) => ({ id: nodeId(slot), ...(layout[nodeId(slot)] ?? auto[nodeId(slot)]) }));
  return { [APP_NODE]: center, ...arrangeInOrder(center, parts, rx, ry) };
}

/** Room for the floating bar on top and the dock below, so a fit never tucks a card under them. */
const FIT_PADDING = { top: "88px", right: "56px", bottom: "104px", left: "56px" } as const;
/** On a phone-sized canvas, fitting a big plan makes cards unreadable. Stop there and let people pan. */
const NARROW_CANVAS = 560;
const NARROW_MIN_ZOOM = 0.45;

/**
 * Keep the plan in view when the step, the visible parts or the canvas size change, and when the
 * layout is tidied up. A fit only happens once every node has been measured, because fitting
 * earlier zooms to the box of the old nodes. Zoom is capped at 100% so a two-part plan doesn't
 * fill the screen. Moving a part never refits: the view stays where the person put it.
 */
function AutoFit({ shape }: { shape: string }) {
  const { fitView } = useReactFlow();
  const ready = useStore((state) => {
    if (state.nodeLookup.size === 0 || state.width === 0 || state.height === 0) return false;
    for (const node of state.nodeLookup.values()) if (!node.measured?.width || !node.measured?.height) return false;
    return true;
  });
  const size = useStore((state) => `${Math.round(state.width)}x${Math.round(state.height)}`);
  const narrow = useStore((state) => state.width > 0 && state.width < NARROW_CANVAS);
  const fitted = useRef("");
  useEffect(() => {
    const key = `${shape}|${size}`;
    if (!ready || fitted.current === key) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: FIT_PADDING, maxZoom: 1, ...(narrow ? { minZoom: NARROW_MIN_ZOOM } : {}), duration: fitted.current ? 250 : 0 });
      fitted.current = key;
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, ready, shape, size, narrow]);
  return null;
}

interface CanvasActions {
  select: (slot: SlotId) => void;
  openConnection: (slot: SlotId) => void;
  ask: (slot: SlotId) => void;
  menu: (target: CanvasTarget, event: ReactMouseEvent) => void;
  add: (slot?: SlotId) => void;
  remove: (slot: SlotId) => void;
}
const ActionsContext = createContext<CanvasActions | null>(null);
const useActions = () => useContext(ActionsContext)!;

/** Lines find their own ends (see wire.ts), so a card needs just one hidden handle of each kind. */
function Handles() {
  return (
    <>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      <Handle type="target" position={Position.Top} isConnectable={false} />
    </>
  );
}

type NoteState = "fresh" | "stale" | undefined;

type WireData = {
  slot: SlotId;
  /** Changes whenever what's at either end changes, so the line plays its "connected" signal again. */
  signal: string;
  /** A connection opens its panel; a line between two parts opens the part it points to. */
  kind: "connection" | "pair";
  other?: SlotId;
  label: string;
  /** The full description, with the variables that travel along it. */
  detail?: string;
  level: Verdict;
  selected: boolean;
  note: NoteState;
};

function boxOf(node: InternalNode): Box | null {
  const { width, height } = node.measured;
  if (!width || !height) return null;
  return { ...node.internals.positionAbsolute, width, height };
}

/**
 * A line between two cards that follows them as they move, with its label as a real button. It
 * reads each card's live position from React Flow, so it redraws on every frame of a drag.
 */
function WireEdge({ id, source, target, data }: EdgeProps<Edge<WireData>>) {
  const actions = useActions();
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  const a = from && boxOf(from);
  const b = to && boxOf(to);
  if (!a || !b || !data) return null;
  const [path, labelX, labelY] = getBezierPath(wireEnds(a, b));
  const open = () => (data.kind === "connection" ? actions.openConnection(data.slot) : actions.select(data.slot));
  const target_: CanvasTarget = data.kind === "connection" ? { kind: "connection", slot: data.slot } : { kind: "pair", slot: data.slot, other: data.other ?? data.slot };
  const status = SIGNAL[data.level];
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={24} />
      {/* Data flowing: a light travels from the app to the service on every line that works, amber on one with a warning, none on a broken one. Each line starts at its own moment. */}
      {FLOWS.has(data.level) && <path d={path} className={cx("ws-wire-flow", `ws-wire-flow--${data.level}`)} fill="none" style={{ animationDelay: `-${flowOffset(id)}ms` }} />}
      <EdgeLabelRenderer>
        <button
          key={data.signal}
          type="button"
          className={cx("ws-wire-label nodrag nopan", `ws-wire-label--${data.level}`, data.kind === "pair" && "is-pair", data.selected && "is-selected")}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={`${status.words}: ${data.detail ?? data.label}${data.note ? `. Has a note${data.note === "stale" ? " written for another option" : ""}` : ""}. Right-click for more.`}
          onClick={open}
          onContextMenu={(e) => actions.menu(target_, e)}
        >
          <span className={cx("ws-sig", `ws-sig--${data.level}`)} aria-label={status.words} role="img">
            {status.glyph}
          </span>
          {data.note && <span className={cx("ws-notedot", data.note === "stale" && "is-stale")} aria-hidden />}
          <span className="ws-wire-label__text">{data.label}</span>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { wire: WireEdge };

const FLOWS = new Set<Verdict>(["works", "info", "warning", "unknown"]);

/** Where in its loop a line's light starts, from its id, so lines don't pulse in step. */
function flowOffset(id: string): number {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(hash) % 3600;
}

/** The mark at the start of every line's label: connected, connected with a warning, broken, missing, or not verified. */
const SIGNAL: Record<Verdict, { glyph: string; words: string }> = {
  works: { glyph: "\u2713", words: "Connected" },
  info: { glyph: "\u2713", words: "Connected" },
  warning: { glyph: "!", words: "Connected, with a warning" },
  unknown: { glyph: "?", words: "Not verified yet" },
  blocked: { glyph: "\u00d7", words: "Doesn't work" },
  missing: { glyph: "+", words: "Needs a part" },
};

type DropState = "" | "is-over" | "is-bad";

type AppData = {
  appName: string;
  /** The app's own logo, when it has one. */
  icon?: string;
  frameworkName?: string;
  frameworkLogo?: LogoFile;
  frameworkLevel: Verdict;
  drop: DropState;
  selected: boolean;
  preview: boolean;
  note: NoteState;
};

function NoteDot({ note }: { note: NoteState }) {
  if (!note) return null;
  return <span className={cx("ws-notedot", note === "stale" && "is-stale")} title={note === "stale" ? "Has a note written for another option" : "Has a note"} />;
}

function AppNode({ data }: NodeProps<Node<AppData>>) {
  const actions = useActions();
  return (
    <div
      className={cx("ws-node ws-app", data.drop, data.selected && "is-selected")}
      data-slot="framework"
      title={`${data.appName}${data.frameworkName ? `, built with ${data.frameworkName}` : ""}. Double-click to ask about it, right-click for more.`}
      onClick={() => actions.select("framework")}
      onDoubleClick={() => actions.ask("framework")}
    >
      <Handles />
      {data.icon ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small data URL the person chose
        <img className="ws-node__icon" src={data.icon} alt="" draggable={false} />
      ) : data.frameworkName ? (
        <Logo logo={data.frameworkLogo} name={data.frameworkName} size={34} />
      ) : (
        <span className="ws-node__blank" aria-hidden />
      )}
      <span className="ws-node__text">
        <span className="ws-node__kicker">{data.preview ? "Your app, preview" : "Your app"}</span>
        <span className="ws-node__name">{data.appName}</span>
        <span className="ws-node__sub">{data.frameworkName ?? "No framework yet"}</span>
      </span>
      <span className="ws-node__marks">
        <NoteDot note={data.note} />
        {data.frameworkName && <VerdictDot level={data.frameworkLevel} />}
      </span>
      <button
        type="button"
        className="ws-node__add nodrag"
        title="Add a part (A)"
        aria-label="Add a part"
        onClick={(e) => {
          e.stopPropagation();
          actions.add();
        }}
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

type SlotData = {
  slot: OuterSlot;
  label: string;
  optionName?: string;
  logo?: LogoFile;
  level: Verdict;
  summary: string;
  needed: boolean;
  drop: DropState;
  selected: boolean;
  note: NoteState;
};

function SlotNode({ data }: NodeProps<Node<SlotData>>) {
  const actions = useActions();
  const empty = !data.optionName;
  return (
    <div
      className={cx("ws-node ws-slot", empty && "is-empty", empty && !data.needed && "is-unneeded", data.drop, data.selected && "is-selected")}
      data-slot={data.slot}
      title={data.summary}
      onClick={() => actions.select(data.slot)}
      onDoubleClick={() => actions.ask(data.slot)}
    >
      <Handles />
      {/* Keyed by the option, so a swap plays the card's "changed" animation. */}
      <span key={data.optionName ?? "empty"} className="ws-node__body">
        {empty ? (
          <span className="ws-node__blank" aria-hidden>
            <Icon name="plus" size={14} />
          </span>
        ) : (
          <Logo logo={data.logo} name={data.optionName!} size={30} />
        )}
        <span className="ws-node__text">
          <span className="ws-node__kicker">{data.label}</span>
          <span className="ws-node__name">{empty ? (data.needed ? "Choose one" : "Optional") : data.optionName}</span>
        </span>
      </span>
      <span className="ws-node__marks">
        <NoteDot note={data.note} />
        {(!empty || data.needed) && <VerdictDot level={data.level} />}
      </span>
      <span className="ws-node__tools nodrag" onClick={(e) => e.stopPropagation()}>
        {empty ? (
          <button type="button" title={`Choose ${inSentence(data.label)}`} aria-label={`Choose ${inSentence(data.label)}`} onClick={() => actions.add(data.slot)}>
            <Icon name="plus" size={13} />
          </button>
        ) : (
          <>
            <button type="button" title="Ask about this" aria-label={`Ask about ${data.optionName}`} onClick={() => actions.ask(data.slot)}>
              <Icon name="sparkle" size={13} />
            </button>
            <button type="button" title="Swap for another" aria-label={`Swap ${data.optionName}`} onClick={() => actions.add(data.slot)}>
              <Icon name="swap" size={13} />
            </button>
            <button type="button" title="Remove (Delete)" aria-label={`Remove ${data.optionName}`} className="is-danger" onClick={() => actions.remove(data.slot)}>
              <Icon name="trash" size={13} />
            </button>
          </>
        )}
      </span>
    </div>
  );
}

const nodeTypes = { app: AppNode, slot: SlotNode };

export function PlanCanvas({
  model,
  selectedSlot,
  selectedConnection,
  dragging,
  showAll,
  fitNonce,
  onDropped,
  onSelect,
  onSelectConnection,
  onDeselect,
  onAsk,
  onMenu,
  onAdd,
  onRemove,
  onToast,
}: {
  model: PlanModel;
  selectedSlot: SlotId | null;
  selectedConnection: SlotId | null;
  dragging: string | null;
  showAll: boolean;
  /** Changes when the layout is tidied or "fit to screen" is pressed, so the view fits again. */
  fitNonce: number;
  onDropped: () => void;
  onSelect: (slot: SlotId) => void;
  onSelectConnection: (slot: SlotId) => void;
  onDeselect: () => void;
  onAsk: (slot: SlotId) => void;
  onMenu: (target: CanvasTarget, x: number, y: number) => void;
  onAdd: (slot?: SlotId) => void;
  onRemove: (slot: SlotId) => void;
  onToast: (message: string) => void;
}) {
  const { plan, dispatch, rec, index, input } = model;
  const [over, setOver] = useState<SlotId | "pane" | null>(null);
  /**
   * Where cards are while they're being dragged. The plan only saves a spot when the card lands,
   * so without these the card would sit still under the pointer and jump on release. Lines read
   * live node positions, so they follow too.
   */
  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({});
  /**
   * Each card's measured size. React Flow keeps a card's measurements (and where its lines attach)
   * only while it gets the same node object back; a new object without `measured` makes it forget
   * them, and until it measures again every line on that card has no ends, so the lines vanish and
   * redraw. The nodes here are rebuilt whenever the plan or the selection changes, so they carry
   * their sizes back in.
   */
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const draggedOption = dragging ? index.optionsById.get(dragging) : undefined;
  /** True from the start of a drag until just after it ends, so letting go doesn't also count as a click. */
  const moving = useRef(false);

  const actions = useMemo<CanvasActions>(
    () => ({
      select: (slot) => {
        if (!moving.current) onSelect(slot);
      },
      openConnection: onSelectConnection,
      ask: onAsk,
      menu: (target, event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu(target, event.clientX, event.clientY);
      },
      add: onAdd,
      remove: onRemove,
    }),
    [onSelect, onSelectConnection, onAsk, onMenu, onAdd, onRemove],
  );

  const visible = useMemo(
    () => OUTER.filter((slot) => Boolean(rec.selection[slot]) || rec.needed.includes(slot) || showAll || Boolean(draggedOption?.slots.includes(slot))),
    [rec.selection, rec.needed, showAll, draggedOption],
  );

  const spots = useMemo(() => {
    const auto = autoLayout(visible);
    const at = (id: string): Spot => plan.layout[id] ?? auto[id] ?? { x: 0, y: 0 };
    return Object.fromEntries([APP_NODE, ...visible.map(nodeId)].map((id) => [id, at(id)]));
  }, [visible, plan.layout]);

  const { nodes, edges } = useMemo(() => {
    const dropClass = (slot: SlotId): DropState => {
      if (!draggedOption || over !== slot) return "";
      return draggedOption.slots.includes(slot) ? "is-over" : "is-bad";
    };
    const touching = (slot: SlotId, filter: (r: CheckResult) => boolean) => rec.results.filter((r) => r.slots.includes(slot) && filter(r));
    const framework = rec.selection.framework ? index.optionsById.get(rec.selection.framework) : undefined;
    const env = planEnv(index, rec.selection);
    const wires = new Map<SlotId, Connection>(connectionsOf(index, rec.selection).map((c) => [c.slot, c]));
    const noteOf = (slot: SlotId): NoteState => {
      const note = plan.notes[slot];
      if (!note?.text.trim()) return undefined;
      return note.optionId && rec.selection[slot] && note.optionId !== rec.selection[slot] ? "stale" : "fresh";
    };

    const nodes: Node[] = [
      {
        id: APP_NODE,
        type: "app",
        position: spots[APP_NODE],
        data: {
          appName: plan.appName.trim() || "Your app",
          icon: plan.icon,
          frameworkName: framework?.name,
          frameworkLogo: framework ? index.catalog.logos[framework.id] : undefined,
          frameworkLevel: worstLevel(touching("framework", (r) => r.slots.length === 1)),
          drop: dropClass("framework"),
          selected: selectedSlot === "framework" && !selectedConnection,
          preview: plan.step !== "plan",
          note: noteOf("framework"),
        } satisfies AppData,
      },
    ];
    const edges: Edge[] = [];

    for (const slot of visible) {
      const optionId = rec.selection[slot];
      const option = optionId ? index.optionsById.get(optionId) : undefined;
      const def = index.slotsById.get(slot)!;
      const needed = rec.needed.includes(slot);
      const wire = wires.get(slot);
      // The line from the app shows this part's own checks; the card shows everything touching it.
      const own = touching(slot, (r) => r.slots.length === 1 || r.slots.includes("framework"));
      const level: Verdict = option ? worstLevel(own) : needed ? "missing" : "works";
      const cardLevel: Verdict = option ? worstLevel(touching(slot, () => true)) : level;
      const facts = option ? optionStats(index, option, slot, input).slice(0, 3) : [];
      const summary = option
        ? [`${def.label}: ${option.name}. ${VERDICT_UI[cardLevel].label}.`, ...facts.map((s) => `${s.label}: ${s.value}.`), "Double-click to ask, right-click for more."].join("\n")
        : needed
          ? `Your answers need ${inSentence(def.label)}. Click to choose one, or drag an option here.`
          : `${def.label} is optional. ${def.empty_hint}.`;

      nodes.push({
        id: nodeId(slot),
        type: "slot",
        position: spots[nodeId(slot)],
        data: {
          slot,
          label: def.label,
          optionName: option?.name,
          logo: option ? index.catalog.logos[option.id] : undefined,
          level: cardLevel,
          summary,
          needed,
          drop: dropClass(slot),
          selected: selectedSlot === slot && !selectedConnection,
          note: noteOf(slot),
        } satisfies SlotData,
      });

      if (option || needed) {
        edges.push({
          id: `edge-${slot}`,
          type: "wire",
          // A fixed stacking order: otherwise React Flow lifts lines touching a dragged card, which
          // rebuilds the line and its label on every frame of the drag and makes them flash.
          zIndex: 0,
          source: APP_NODE,
          target: nodeId(slot),
          className: cx("ws-edge", `ws-edge--${level}`, !option && "is-dashed", selectedConnection === slot && "is-selected"),
          data: {
            slot,
            signal: `${framework?.id ?? ""}>${optionId ?? ""}:${level}`,
            kind: "connection",
            // The verb alone keeps the canvas quiet; the variables are in the tooltip and the connection panel.
            label: wire ? def.verb : `needs ${inSentence(def.label)}`,
            detail: wire ? connectionLabel(wire, env) : undefined,
            level,
            selected: selectedConnection === slot,
            note: noteOf(slot),
          } satisfies WireData,
        });
      }
    }

    // Problems between two parts of the stack get their own line.
    const pairs = new Map<string, CheckResult[]>();
    for (const r of rec.results) {
      if (r.slots.length !== 2 || r.slots.includes("framework") || r.level === "info") continue;
      if (!r.slots.every((s) => rec.selection[s])) continue; // a check about an empty slot belongs to the one card
      const key = r.slots.join("|");
      pairs.set(key, [...(pairs.get(key) ?? []), r]);
    }
    for (const [key, results] of pairs) {
      const [a, b] = key.split("|") as [OuterSlot, OuterSlot];
      if (!spots[nodeId(a)] || !spots[nodeId(b)]) continue;
      const level = worstLevel(results);
      edges.push({
        id: `pair-${key}`,
        type: "wire",
        zIndex: 0,
        source: nodeId(a),
        target: nodeId(b),
        className: cx("ws-edge", `ws-edge--${level}`, "is-pair"),
        data: {
          slot: b,
          signal: `${rec.selection[a]}>${rec.selection[b]}:${level}`,
          other: a,
          kind: "pair",
          label: results.length > 1 ? `${results[0].title} (+${results.length - 1})` : results[0].title,
          level,
          selected: false,
          note: undefined,
        } satisfies WireData,
      });
    }

    return { nodes, edges };
  }, [rec, index, input, plan.appName, plan.icon, plan.step, plan.notes, selectedSlot, selectedConnection, over, draggedOption, visible, spots]);

  // A drag only moves cards: their data (verdicts, stats, notes) isn't rebuilt on every pointer move.
  const placed = useMemo(
    () => nodes.map((n) => ({ ...n, ...(sizes[n.id] ? { measured: sizes[n.id] } : {}), ...(dragged[n.id] ? { position: dragged[n.id] } : {}) })),
    [nodes, dragged, sizes],
  );

  const slotAt = (event: DragEvent): SlotId | null => {
    const el = (event.target as HTMLElement).closest("[data-slot]");
    return (el?.getAttribute("data-slot") as SlotId | null) ?? null;
  };

  /**
   * Where a part was dropped. Parts are positioned by their middle (nodeOrigin), but React Flow
   * hands back the top left corner after a drag, so half the measured size goes back on. Without
   * that the part hops up and to the left by half its size the moment it lands.
   */
  const land = useCallback(
    (node: Node) => {
      const spot = { x: Math.round(node.position.x + (node.measured?.width ?? 0) / 2), y: Math.round(node.position.y + (node.measured?.height ?? 0) / 2) };
      dispatch({ type: "moveNodes", spots: { [node.id]: spot } });
      setDragged((current) => {
        const next = { ...current };
        delete next[node.id];
        return next;
      });
    },
    [dispatch],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const moves = changes.flatMap((c) => (c.type === "position" && c.dragging && c.position ? [[c.id, c.position] as const] : []));
    if (moves.length) setDragged((current) => ({ ...current, ...Object.fromEntries(moves) }));
    const measured = changes.flatMap((c) => (c.type === "dimensions" && c.dimensions ? [[c.id, c.dimensions] as const] : []));
    if (measured.length) {
      setSizes((current) => {
        const changed = measured.some(([id, d]) => current[id]?.width !== d.width || current[id]?.height !== d.height);
        return changed ? { ...current, ...Object.fromEntries(measured) } : current;
      });
    }
  }, []);

  const slotOfNode = (id: string): SlotId => (id === APP_NODE ? "framework" : (id.slice("slot-".length) as SlotId));

  return (
    <ActionsContext.Provider value={actions}>
      <div
        className={cx("ws-canvas", dragging && "is-dragging")}
        onDragOver={(e) => {
          if (!dragging) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const slot = slotAt(e) ?? "pane";
          if (slot !== over) setOver(slot);
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as globalThis.Node | null)) setOver(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const optionId = e.dataTransfer.getData("application/x-whystack-option") || dragging;
          setOver(null);
          onDropped();
          if (!optionId) return;
          const error = model.place(optionId, slotAt(e) ?? undefined, selectedSlot);
          if (error) onToast(error);
        }}
      >
        <ReactFlow
          nodes={placed}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodeOrigin={[0.5, 0.5]}
          onNodesChange={onNodesChange}
          colorMode="system"
          fitView
          fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1 }}
          minZoom={0.25}
          maxZoom={1.6}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          onNodeDragStart={() => {
            moving.current = true;
          }}
          onNodeDragStop={(_, node) => {
            land(node);
            // The click that ends a drag arrives after this; let it pass before clicks count again.
            window.setTimeout(() => {
              moving.current = false;
            }, 0);
          }}
          onEdgeClick={(_, edge) => {
            const data = edge.data as WireData | undefined;
            if (data) (data.kind === "connection" ? onSelectConnection : onSelect)(data.slot);
          }}
          onPaneClick={onDeselect}
          onNodeContextMenu={(e, node) => actions.menu({ kind: "part", slot: slotOfNode(node.id) }, e)}
          onEdgeContextMenu={(e, edge) => {
            const data = edge.data as WireData | undefined;
            if (data) actions.menu(data.kind === "connection" ? { kind: "connection", slot: data.slot } : { kind: "pair", slot: data.slot, other: data.other ?? data.slot }, e);
          }}
          onPaneContextMenu={(e) => actions.menu({ kind: "canvas" }, e as ReactMouseEvent)}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="var(--ws-canvas-dot)" />
          <AutoFit shape={`${plan.step}|${visible.join(",")}|${fitNonce}`} />
        </ReactFlow>
      </div>
    </ActionsContext.Provider>
  );
}
