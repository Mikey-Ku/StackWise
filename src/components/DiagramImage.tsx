"use client";

import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { toPng } from "html-to-image";

/**
 * Saving the diagram as a PNG for slides. It draws every card and line at full size (not the
 * current zoom) at twice the pixels, so it stays sharp on a projector, with the page's own
 * background or none at all. Buttons that only make sense on the canvas are left out.
 */

export interface ImageRequest {
  nonce: number;
  transparent: boolean;
}

const PADDING = 56;
let warmedUp = false;
const PIXEL_RATIO = 2;
/** Canvas-only controls: the + on the app card and the tools on a selected card. */
const LEAVE_OUT = ["ws-node__add", "ws-node__tools", "react-flow__handle"];

export function DiagramImage({ request, fileName, onDone }: { request: ImageRequest | null; fileName: string; onDone: (message: string) => void }) {
  const { getNodes, getNodesBounds } = useReactFlow();
  const handled = useRef(0);

  useEffect(() => {
    if (!request || handled.current === request.nonce) return;
    handled.current = request.nonce;
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    const nodes = getNodes().filter((n) => !n.hidden);
    if (!viewport || nodes.length === 0) return onDone("There's nothing on the canvas to save yet.");

    const bounds = getNodesBounds(nodes);
    const width = Math.ceil(bounds.width + PADDING * 2);
    const height = Math.ceil(bounds.height + PADDING * 2);
    const canvas = viewport.closest(".react-flow") as HTMLElement | null;
    const backgroundColor = request.transparent ? undefined : getComputedStyle(canvas ?? document.body).backgroundColor;

    const options = {
      width,
      height,
      pixelRatio: PIXEL_RATIO,
      backgroundColor,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${PADDING - bounds.x}px, ${PADDING - bounds.y}px) scale(1)` },
      filter: (node: HTMLElement) => !(node instanceof Element && LEAVE_OUT.some((name) => node.classList.contains(name))),
    };
    // The first drawing after a page load can come out empty while the logos are still being
    // inlined, so the first save draws once to warm up and keeps the second.
    canvas?.classList.add("is-exporting");
    (warmedUp ? toPng(viewport, options) : toPng(viewport, options).then(() => ((warmedUp = true), toPng(viewport, options))))
      .finally(() => canvas?.classList.remove("is-exporting"))
      .then((url) => {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${fileName}.png`;
        link.click();
        onDone(`Saved ${fileName}.png${request.transparent ? " with a transparent background" : ""}.`);
      })
      .catch(() => onDone("Couldn't draw the diagram. Try again after the canvas finishes loading."));
  }, [request, fileName, getNodes, getNodesBounds, onDone]);

  return null;
}
