import { Position } from "@xyflow/react";

/**
 * Geometry for the lines between parts. A line runs between the middles of two cards and starts
 * where it leaves each card's box, on whichever side it crosses. It's worked out from where the
 * cards are right now, so lines follow a card while it's being dragged.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgePoint {
  x: number;
  y: number;
  side: Position;
}

/** Where the line from a's middle toward b's middle crosses a's border. */
export function edgePoint(a: Box, b: Box): EdgePoint {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const dx = b.x + b.width / 2 - ax;
  const dy = b.y + b.height / 2 - ay;
  if (dx === 0 && dy === 0) return { x: ax, y: ay + a.height / 2, side: Position.Bottom };
  const across = Math.abs(dx) / (a.width / 2);
  const down = Math.abs(dy) / (a.height / 2);
  const scale = 1 / Math.max(across, down);
  const side = across >= down ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top;
  return { x: ax + dx * scale, y: ay + dy * scale, side };
}

/** Both ends of a line between two cards, ready for React Flow's path helpers. */
export function wireEnds(source: Box, target: Box) {
  const start = edgePoint(source, target);
  const end = edgePoint(target, source);
  return { sourceX: start.x, sourceY: start.y, sourcePosition: start.side, targetX: end.x, targetY: end.y, targetPosition: end.side };
}
