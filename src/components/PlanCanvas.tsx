"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cardStats, inSentence, money, optionStats, SIZE_PHRASE, worstLevel, type CheckResult, type Logo as LogoFile, type SlotId, type Stat } from "@/engine";
import type { PlanModel } from "./usePlans";
import { Logo, StatChips, VerdictBadge, VerdictDot, cx, type Verdict } from "./ui";

/**
 * The canvas is a graph with typed connections (see docs/DECISIONS.md), shown for now as one app
 * in the middle with a slot for each part of the stack. Every connection has exactly one meaning,
 * so every one can be checked. Parts the plan doesn't need stay hidden until they're filled,
 * "show all parts" is on, or someone drags an option that fits one.
 */

type OuterSlot = Exclude<SlotId, "framework">;
/** Clockwise from the top. Parts that often get a line between them (hosting and database, login and email, email and domain) sit side by side. */
const OUTER: OuterSlot[] = ["hosting", "database", "login", "email", "domain", "files", "payments", "ai", "mobile", "jobs", "analytics", "monitoring", "scraping"];

function sideToward(from: { x: number; y: number }, to: { x: number; y: number }): { source: Position; target: Position } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { source: Position.Right, target: Position.Left } : { source: Position.Left, target: Position.Right };
  return dy >= 0 ? { source: Position.Bottom, target: Position.Top } : { source: Position.Top, target: Position.Bottom };
}

/**
 * The parts on the canvas sit on an ellipse around the app, clockwise from the top, spaced evenly
 * among the ones that are showing, so a small plan is as balanced as a big one. The ellipse grows
 * with the number of parts so cards don't overlap.
 */
function layout(visible: OuterSlot[]) {
  const rx = Math.min(660, Math.max(380, 300 + visible.length * 26));
  const ry = Math.round(rx * 0.85);
  const position = Object.fromEntries(
    visible.map((slot, i) => {
      const angle = ((-90 + (i * 360) / visible.length) * Math.PI) / 180;
      return [slot, { x: Math.round(rx * Math.cos(angle)), y: Math.round(ry * Math.sin(angle)) }];
    }),
  ) as Record<OuterSlot, { x: number; y: number }>;
  const side = Object.fromEntries(
    visible.map((slot) => {
      const { source, target } = sideToward({ x: 0, y: 0 }, position[slot]);
      return [slot, { app: source, slot: target }];
    }),
  ) as Record<OuterSlot, { app: Position; slot: Position }>;
  return { position, side };
}

/** Room for the "show all parts" button and the preview banner above the plan. */
const FIT_PADDING = { top: "60px", right: "28px", bottom: "28px", left: "28px" } as const;

/**
 * Keep the plan in view when the step, the visible parts or the canvas size change. A fit only
 * happens once every node has been measured, because fitting earlier zooms to the box of the old
 * nodes. Zoom is capped at 100% so a two-part plan doesn't fill the screen.
 */
function AutoFit({ shape }: { shape: string }) {
  const { fitView } = useReactFlow();
  const ready = useStore((state) => {
    if (state.nodeLookup.size === 0 || state.width === 0 || state.height === 0) return false;
    for (const node of state.nodeLookup.values()) if (!node.measured?.width || !node.measured?.height) return false;
    return true;
  });
  const size = useStore((state) => `${Math.round(state.width)}x${Math.round(state.height)}`);
  const fitted = useRef("");
  useEffect(() => {
    const key = `${shape}|${size}`;
    if (!ready || fitted.current === key) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: FIT_PADDING, maxZoom: 1, duration: fitted.current ? 250 : 0 });
      fitted.current = key;
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, ready, shape, size]);
  return null;
}

interface CanvasActions {
  select: (slot: SlotId) => void;
  clear: (slot: SlotId) => void;
  autoPick: (slot: SlotId) => void;
}
const ActionsContext = createContext<CanvasActions | null>(null);
const useActions = () => useContext(ActionsContext)!;

function Handles() {
  return (
    <>
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((p) => (
        <span key={p}>
          <Handle type="source" position={p} id={`src-${p}`} isConnectable={false} />
          <Handle type="target" position={p} id={`tgt-${p}`} isConnectable={false} />
        </span>
      ))}
    </>
  );
}

type DropState = "" | "is-over" | "is-bad";

type AppData = {
  appName: string;
  frameworkName?: string;
  frameworkLogo?: LogoFile;
  frameworkLevel: Verdict;
  needs: string[];
  drop: DropState;
  selected: boolean;
  preview: boolean;
};

function AppNode({ data }: NodeProps<Node<AppData>>) {
  const actions = useActions();
  return (
    <div className={cx("ws-node ws-app", data.drop, data.selected && "is-selected")} data-slot="framework" onClick={() => actions.select("framework")}>
      <Handles />
      <span className="mk-eyebrow">{data.preview ? "Your app (preview)" : "Your app"}</span>
      <div className="ws-app__name">{data.appName}</div>
      <div className="ws-app__fw">
        <span className="mk-faint">built with</span>
        {data.frameworkName && <Logo logo={data.frameworkLogo} name={data.frameworkName} size={20} />}
        <strong>{data.frameworkName ?? "no framework yet"}</strong>
        {data.frameworkName && <VerdictDot level={data.frameworkLevel} />}
      </div>
      {data.needs.length > 0 && (
        <div className="ws-app__needs">
          {data.needs.map((n) => (
            <span key={n} className="mk-badge">
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type SlotData = {
  slot: OuterSlot;
  label: string;
  hint: string;
  optionName?: string;
  logo?: LogoFile;
  level: Verdict;
  stats: Stat[];
  auto: boolean;
  needed: boolean;
  cleared: boolean;
  drop: DropState;
  selected: boolean;
};

function SlotNode({ data }: NodeProps<Node<SlotData>>) {
  const actions = useActions();
  const empty = !data.optionName;
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div
      className={cx("ws-node ws-slot", empty && "is-empty", empty && !data.needed && "is-unneeded", data.drop, data.selected && "is-selected")}
      data-slot={data.slot}
      onClick={() => actions.select(data.slot)}
    >
      <Handles />
      <div className="ws-slot__head">
        <span className="mk-eyebrow">{data.label}</span>
        {!empty && <VerdictBadge level={data.level} short />}
        {empty && data.needed && <VerdictBadge level="missing" short />}
      </div>
      {empty ? (
        <div className="ws-slot__empty">
          <p>{data.needed ? `Your answers need this. Drag a ${inSentence(data.label)} option here.` : `Optional. ${data.hint}.`}</p>
          {data.needed && data.cleared && (
            <button type="button" className="mk-btn mk-btn--secondary mk-sm" onClick={stop(() => actions.autoPick(data.slot))}>
              Pick one for me
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="ws-slot__name">
            <Logo logo={data.logo} name={data.optionName!} size={26} />
            <span>{data.optionName}</span>
          </div>
          <StatChips stats={data.stats} />
          <div className="ws-slot__foot">
            <span className="mk-faint">{data.auto ? "Picked for you" : "Your choice"}</span>
            <span className="mk-row mk-gap-1">
              {!data.auto && data.needed && (
                <button type="button" className="ws-link" onClick={stop(() => actions.autoPick(data.slot))}>
                  Re-pick
                </button>
              )}
              <button type="button" className="ws-link" onClick={stop(() => (data.needed ? actions.clear(data.slot) : actions.autoPick(data.slot)))}>
                {data.needed ? "Clear" : "Remove"}
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

const nodeTypes = { app: AppNode, slot: SlotNode };

/** The whole plan in five numbers above the canvas: what it costs, when that changes, and how much setup it takes. */
function PlanStatsBar({ model }: { model: PlanModel }) {
  const { stats } = model;
  const extraCosts = [stats.now.yearlyUsd > 0 && `+ ${money(stats.now.yearlyUsd)}/yr`, stats.now.oneTimeUsd > 0 && `+ ${money(stats.now.oneTimeUsd)} once`].filter(Boolean).join(", ");
  const jump = stats.firstIncrease;
  const checksLevel: Verdict = stats.problems === 0 ? "works" : stats.worst;
  return (
    <dl className="ws-planstats" aria-label="Your plan at a glance">
      <div className="ws-planstats__item">
        <dt>Monthly cost</dt>
        <dd>
          <strong>
            {money(stats.now.monthlyUsd)}
            <small>/mo</small>
          </strong>
          <span>
            for {SIZE_PHRASE[stats.now.size]}
            {stats.now.hasUsage ? " + usage" : ""}
          </span>
          {extraCosts && <span title="Domain and app store fees, billed apart from the monthly total">{extraCosts}</span>}
          {stats.now.hasUnknown && <span>some prices not verified</span>}
        </dd>
      </div>
      <div className="ws-planstats__item">
        <dt>As you grow</dt>
        <dd>
          {jump ? (
            <>
              <strong>
                {money(jump.monthlyUsd)}
                <small>/mo</small>
              </strong>
              <span>at {SIZE_PHRASE[jump.size]}</span>
            </>
          ) : (
            <>
              <strong>No jump</strong>
              <span>{stats.now.size === "more" ? "you picked the largest size" : "plan prices stay the same"}</span>
            </>
          )}
        </dd>
      </div>
      <div className="ws-planstats__item">
        <dt>Accounts</dt>
        <dd>
          <strong>{stats.accounts}</strong>
          <span>to sign up for</span>
        </dd>
      </div>
      <div className="ws-planstats__item">
        <dt>Setup steps</dt>
        <dd>
          <strong>{stats.setupSteps}</strong>
          <span>in the checklist</span>
        </dd>
      </div>
      <div className={cx("ws-planstats__item", `ws-planstats__item--${checksLevel}`)}>
        <dt>Checks</dt>
        <dd>
          <strong>{stats.problems === 0 ? "All clear" : stats.problems}</strong>
          <span>{stats.problems === 0 ? "every connection works" : `thing${stats.problems === 1 ? "" : "s"} to look at`}</span>
        </dd>
      </div>
    </dl>
  );
}

function truncate(text: string, max = 34): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
}

export function PlanCanvas({
  model,
  selectedSlot,
  dragging,
  showAll,
  onToggleShowAll,
  onDropped,
  onSelect,
  onToast,
}: {
  model: PlanModel;
  selectedSlot: SlotId | null;
  dragging: string | null;
  showAll: boolean;
  onToggleShowAll: () => void;
  onDropped: () => void;
  onSelect: (slot: SlotId) => void;
  onToast: (message: string) => void;
}) {
  const { plan, dispatch, rec, index, input } = model;
  const [over, setOver] = useState<SlotId | "pane" | null>(null);
  const draggedOption = dragging ? index.optionsById.get(dragging) : undefined;

  const actions = useMemo<CanvasActions>(
    () => ({
      select: onSelect,
      clear: (slot) => dispatch({ type: "clearSlot", slot }),
      autoPick: (slot) => dispatch({ type: "autoPick", slot }),
    }),
    [dispatch, onSelect],
  );

  const visible = useMemo(
    () => OUTER.filter((slot) => Boolean(rec.selection[slot]) || rec.needed.includes(slot) || showAll || Boolean(draggedOption?.slots.includes(slot))),
    [rec.selection, rec.needed, showAll, draggedOption],
  );

  const { nodes, edges } = useMemo(() => {
    const dropClass = (slot: SlotId): DropState => {
      if (!draggedOption || over !== slot) return "";
      return draggedOption.slots.includes(slot) ? "is-over" : "is-bad";
    };
    const touching = (slot: SlotId, filter: (r: CheckResult) => boolean) => rec.results.filter((r) => r.slots.includes(slot) && filter(r));
    const { position: POSITION, side: SIDE } = layout(visible);
    const framework = rec.selection.framework ? index.optionsById.get(rec.selection.framework) : undefined;

    const nodes: Node[] = [
      {
        id: "app",
        type: "app",
        position: { x: 0, y: 0 },
        data: {
          appName: plan.appName.trim() || "Your app",
          frameworkName: framework?.name,
          frameworkLogo: framework ? index.catalog.logos[framework.id] : undefined,
          frameworkLevel: worstLevel(touching("framework", (r) => r.slots.length === 1)),
          needs: index.catalog.needs.filter((n) => input.answers[n.id] === "yes").map((n) => n.label),
          drop: dropClass("framework"),
          selected: selectedSlot === "framework",
          preview: plan.step !== "plan",
        } satisfies AppData,
      },
    ];
    const edges: Edge[] = [];

    for (const slot of visible) {
      const optionId = rec.selection[slot];
      const option = optionId ? index.optionsById.get(optionId) : undefined;
      const def = index.slotsById.get(slot)!;
      const needed = rec.needed.includes(slot);
      // The line from the app shows this part's own checks; the card shows everything touching it.
      const own = touching(slot, (r) => r.slots.length === 1 || r.slots.includes("framework"));
      const level: Verdict = option ? worstLevel(own) : needed ? "missing" : "works";

      nodes.push({
        id: `slot-${slot}`,
        type: "slot",
        position: POSITION[slot],
        data: {
          slot,
          label: def.label,
          hint: def.empty_hint,
          optionName: option?.name,
          logo: option ? index.catalog.logos[option.id] : undefined,
          level: option ? worstLevel(touching(slot, () => true)) : level,
          stats: option ? cardStats(optionStats(index, option, slot, input), 2) : [],
          auto: rec.autoPicked.includes(slot),
          needed,
          cleared: plan.pinned[slot] === "",
          drop: dropClass(slot),
          selected: selectedSlot === slot,
        } satisfies SlotData,
      });

      if (option || needed) {
        edges.push({
          id: `edge-${slot}`,
          source: "app",
          target: `slot-${slot}`,
          sourceHandle: `src-${SIDE[slot].app}`,
          targetHandle: `tgt-${SIDE[slot].slot}`,
          label: option ? def.verb : `needs ${inSentence(def.label)}`,
          className: cx("ws-edge", `ws-edge--${level}`, !option && "is-dashed"),
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 3,
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
      if (!POSITION[a] || !POSITION[b]) continue;
      const sides = sideToward(POSITION[a], POSITION[b]);
      edges.push({
        id: `pair-${key}`,
        source: `slot-${a}`,
        target: `slot-${b}`,
        sourceHandle: `src-${sides.source}`,
        targetHandle: `tgt-${sides.target}`,
        label: truncate(results.length > 1 ? `${results[0].title} (+${results.length - 1})` : results[0].title),
        className: cx("ws-edge", `ws-edge--${worstLevel(results)}`, "is-pair"),
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 3,
      });
    }

    return { nodes, edges };
  }, [rec, index, input, plan.appName, plan.pinned, plan.step, selectedSlot, over, draggedOption, visible]);

  const slotAt = (event: DragEvent): SlotId | null => {
    const el = (event.target as HTMLElement).closest("[data-slot]");
    return (el?.getAttribute("data-slot") as SlotId | null) ?? null;
  };

  const hiddenCount = OUTER.length - visible.length;

  return (
    <ActionsContext.Provider value={actions}>
      <div className="ws-canvas-frame">
        {plan.step !== "describe" && <PlanStatsBar model={model} />}
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
          {plan.step !== "plan" && (
            <div className="ws-canvas__banner">
              {plan.step === "describe" ? "Describe your app to fill this in." : "Preview from your answers so far. Confirm them to lock in the plan."}
            </div>
          )}
          <button type="button" className="ws-canvas__toggle mk-btn mk-btn--secondary mk-sm" onClick={onToggleShowAll}>
            {showAll ? "Hide optional parts" : hiddenCount > 0 ? `Show all parts (+${hiddenCount})` : "Show all parts"}
          </button>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodeOrigin={[0.5, 0.5]}
            fitView
            fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1 }}
            minZoom={0.25}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            onEdgeClick={(_, edge) => onSelect(edge.target.replace("slot-", "") as SlotId)}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--mk-line-strong)" />
            <Controls showInteractive={false} position="bottom-right" />
            <AutoFit shape={`${plan.step}|${visible.join(",")}`} />
          </ReactFlow>
        </div>
      </div>
    </ActionsContext.Provider>
  );
}
