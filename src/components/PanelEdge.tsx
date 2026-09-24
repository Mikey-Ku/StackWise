"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Dragging a side panel's inner edge to make it wider or narrower. The width is kept per panel in
 * this browser; double-clicking the edge puts it back. Arrow keys work too once the edge has focus.
 */

const MIN = 300;
const maxWidth = () => Math.max(MIN, Math.min(760, Math.round(window.innerWidth * 0.55)));
const clamp = (width: number) => Math.round(Math.min(maxWidth(), Math.max(MIN, width)));

export function usePanelWidth(key: string, fallback: number): [number, (width: number) => void] {
  const storageKey = `whystack.width.${key}`;
  // The workspace only renders in the browser (ClientRoot), so the saved width can be read at once.
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      return saved ? clamp(saved) : fallback;
    } catch {
      return fallback;
    }
  });
  const save = useCallback(
    (next: number) => {
      const value = clamp(next);
      setWidth(value);
      try {
        if (value === fallback) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, String(value));
      } catch {
        // Private windows: the width lasts until the tab closes.
      }
    },
    [storageKey, fallback],
  );
  return [width, save];
}

export function PanelEdge({ side, width, fallback, onResize }: { side: "left" | "right"; width: number; fallback: number; onResize: (width: number) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // The left panel grows to the right; the right panel grows to the left.
  const direction = side === "left" ? 1 : -1;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width };
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    onResize(start.current.width + (e.clientX - start.current.x) * direction);
  };
  const up = () => {
    start.current = null;
    setDragging(false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") onResize(width - step * direction);
    else if (e.key === "ArrowRight") onResize(width + step * direction);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={`ws-edge-grip ws-edge-grip--${side}${dragging ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize the panel. Double-click to reset."
      aria-valuenow={width}
      aria-valuemin={MIN}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onResize(fallback)}
      onKeyDown={key}
    />
  );
}
