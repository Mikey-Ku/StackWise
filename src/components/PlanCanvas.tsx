"use client";

import { createContext, useContext, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { costLine, worstLevel, type CheckResult, type SlotId } from "@/engine";
import type { PlanModel } from "./usePlan";
import { VerdictBadge, VerdictDot, cx, type Verdict } from "./ui";

/**
 * The canvas is stored as a graph with typed connections (see docs/DECISIONS.md), shown for now
 * as one app in the middle with a slot for each part of the stack. Every connection has exactly
 * one meaning, so every one can be checked.
 */

type OuterSlot = Exclude<SlotId, "framework">;
const OUTER: OuterSlot[] = ["hosting", "database", "login", "email", "files", "payments", "ai", "jobs", "mobile"];

/** Parts sit on an ellipse around the app, clockwise from hosting at the top. */
const POSITION = Object.fromEntries(
  OUTER.map((slot, i) => {
    const angle = ((-90 + i * 40) * Math.PI) / 180;
    return [slot, { x: Math.round(400 * Math.cos(angle)), y: Math.round(300 * Math.sin(angle)) }];
  }),
) as Record<OuterSlot, { x: number; y: number }>;

/** Keep the whole plan in view when the panel resizes or the plan's shape changes. */
function AutoFit({ shape }: { shape: string }) {
  const { fitView } = useReactFlow();
  // Fitting before React Flow has measured the nodes zooms to the wrong box, so wait for it.
  const measured = useNodesInitialized();
  useEffect(() => {
    if (!measured) return;
    const frame = requestAnimationFrame(() => fitView({ padding: 0.08, duration: 250 }));
    return () => cancelAnimationFrame(frame);
  }, [fitView, shape, measured]);
  useEffect(() => {
    const onResize = () => fitView({ padding: 0.08 });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitView]);
  return null;
}

const SIDE = Object.fromEntries(
  OUTER.map((slot) => {
    const { source, target } = sideToward({ x: 0, y: 0 }, POSITION[slot]);
    return [slot, { app: source, slot: target }];
  }),
) as Record<OuterSlot, { app: Position; slot: Position }>;

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

type AppData = {
  appName: string;
  frameworkName?: string;
  frameworkLevel: Verdict;
  needs: string[];
  drop: "" | "is-over" | "is-bad";
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
  level: Verdict;
  cost?: string;
  auto: boolean;
  needed: boolean;
  cleared: boolean;
  drop: "" | "is-over" | "is-bad";
  selected: boolean;
};

function SlotNode({ data }: NodeProps<Node<SlotData>>) {
  const actions = useActions();
  const empty = !data.optionName;
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
          <p>{data.needed ? `Your answers need this. Drag a ${data.label.toLowerCase()} option here.` : data.hint}</p>
          {data.needed && data.cleared && (
            <button
              type="button"
              className="mk-btn mk-btn--secondary mk-sm"
              onClick={(e) => {
                e.stopPropagation();
                actions.autoPick(data.slot);
              }}
            >
              Pick one for me
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="ws-slot__name">{data.optionName}</div>
          {data.cost && <div className="ws-slot__cost">{data.cost}</div>}
          <div className="ws-slot__foot">
            <span className="mk-faint">{data.auto ? "Picked for you" : "Your choice"}</span>
            <span className="mk-row mk-gap-1">
              {!data.auto && (
                <button
                  type="button"
                  className="ws-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.autoPick(data.slot);
                  }}
                >
                  Re-pick
                </button>
              )}
              <button
                type="button"
                className="ws-link"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.clear(data.slot);
                }}
              >
                Clear
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

const nodeTypes = { app: AppNode, slot: SlotNode };

function truncate(text: string, max = 34): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
}

function sideToward(from: { x: number; y: number }, to: { x: number; y: number }): { source: Position; target: Position } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { source: Position.Right, target: Position.Left } : { source: Position.Left, target: Position.Right };
  return dy >= 0 ? { source: Position.Bottom, target: Position.Top } : { source: Position.Top, target: Position.Bottom };
}

export function PlanCanvas({
  plan,
  dragging,
  onDropped,
  onSelect,
  onToast,
}: {
  plan: PlanModel;
  dragging: string | null;
  onDropped: () => void;
  onSelect: (slot: SlotId) => void;
  onToast: (message: string) => void;
}) {
  const { state, dispatch, rec, index, input } = plan;
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

  const dropClass = (slot: SlotId): "" | "is-over" | "is-bad" => {
    if (!draggedOption || over !== slot) return "";
    return draggedOption.slots.includes(slot) ? "is-over" : "is-bad";
  };

  const { nodes, edges } = useMemo(() => {
    const touching = (slot: SlotId, filter: (r: CheckResult) => boolean) => rec.results.filter((r) => r.slots.includes(slot) && filter(r));
    const framework = rec.selection.framework ? index.optionsById.get(rec.selection.framework) : undefined;
    const needLabels = index.catalog.needs.filter((n) => input.answers[n.id] === "yes").map((n) => n.label);

    const nodes: Node[] = [
      {
        id: "app",
        type: "app",
        position: { x: 0, y: 0 },
        data: {
          appName: state.appName.trim() || "Your app",
          frameworkName: framework?.name,
          frameworkLevel: worstLevel(touching("framework", (r) => r.slots.length === 1)),
          needs: needLabels,
          drop: dropClass("framework"),
          selected: state.selectedSlot === "framework",
          preview: state.step !== "plan",
        } satisfies AppData,
      },
    ];
    const edges: Edge[] = [];

    for (const slot of OUTER) {
      const optionId = rec.selection[slot];
      const option = optionId ? index.optionsById.get(optionId) : undefined;
      const def = index.slotsById.get(slot)!;
      const needed = rec.needed.includes(slot);
      // The line from the app shows this slot's own checks (alone, or with the framework). The card
      // shows everything touching the slot, including problems with other parts of the stack.
      const own = touching(slot, (r) => r.slots.length === 1 || r.slots.includes("framework"));
      const level: Verdict = option ? worstLevel(own) : needed ? "missing" : "works";
      const cardLevel: Verdict = option ? worstLevel(touching(slot, () => true)) : level;

      nodes.push({
        id: `slot-${slot}`,
        type: "slot",
        position: POSITION[slot],
        data: {
          slot,
          label: def.label,
          hint: def.empty_hint,
          optionName: option?.name,
          level: cardLevel,
          cost: option ? costLine(index, option, slot, input).headline : undefined,
          auto: rec.autoPicked.includes(slot),
          needed,
          cleared: state.pinned[slot] === "",
          drop: dropClass(slot),
          selected: state.selectedSlot === slot,
        } satisfies SlotData,
      });

      if (option || needed) {
        edges.push({
          id: `edge-${slot}`,
          source: "app",
          target: `slot-${slot}`,
          sourceHandle: `src-${SIDE[slot].app}`,
          targetHandle: `tgt-${SIDE[slot].slot}`,
          label: option ? def.verb : `needs ${def.label.toLowerCase()}`,
          className: cx("ws-edge", `ws-edge--${level}`, !option && "is-dashed"),
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 3,
        });
      }
    }

    // Verdicts between two parts of the stack get their own line, drawn only when there is a problem.
    const pairs = new Map<string, CheckResult[]>();
    for (const r of rec.results) {
      if (r.slots.length !== 2 || r.slots.includes("framework") || r.level === "info") continue;
      const key = r.slots.join("|");
      pairs.set(key, [...(pairs.get(key) ?? []), r]);
    }
    for (const [key, results] of pairs) {
      const [a, b] = key.split("|") as [OuterSlot, OuterSlot];
      const level = worstLevel(results);
      const sides = sideToward(POSITION[a], POSITION[b]);
      edges.push({
        id: `pair-${key}`,
        source: `slot-${a}`,
        target: `slot-${b}`,
        sourceHandle: `src-${sides.source}`,
        targetHandle: `tgt-${sides.target}`,
        label: truncate(results.length > 1 ? `${results[0].title} (+${results.length - 1})` : results[0].title),
        className: cx("ws-edge", `ws-edge--${level}`, "is-pair"),
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 3,
      });
    }

    return { nodes, edges };
    // dropClass reads `over` and the dragged option, which are listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, index, input, state.appName, state.selectedSlot, state.pinned, state.step, over, draggedOption]);

  const slotAt = (event: DragEvent): SlotId | null => {
    const el = (event.target as HTMLElement).closest("[data-slot]");
    return (el?.getAttribute("data-slot") as SlotId | null) ?? null;
  };

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
          const error = plan.place(optionId, slotAt(e) ?? undefined);
          if (error) onToast(error);
        }}
      >
        {state.step !== "plan" && (
          <div className="ws-canvas__banner">
            {state.step === "describe" ? "Describe your app to fill this in." : "Preview from your answers so far. Confirm them to lock in the plan."}
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodeOrigin={[0.5, 0.5]}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.3}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onEdgeClick={(_, edge) => {
            const target = edge.target.replace("slot-", "") as SlotId;
            onSelect(target);
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--mk-line-strong)" />
          <Controls showInteractive={false} position="bottom-right" />
          <AutoFit shape={`${state.step}|${rec.needed.join(",")}`} />
        </ReactFlow>
      </div>
    </ActionsContext.Provider>
  );
}
