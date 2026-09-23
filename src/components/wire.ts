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

/**
 * Tidying without undoing the person's arrangement: the parts keep the order they're in around
 * the center, clockwise from the top, and are spaced evenly on an ellipse. Lines that all run out
 * from the center can't cross each other that way, however the cards had been dragged.
 */
export function arrangeInOrder(center: { x: number; y: number }, parts: { id: string; x: number; y: number }[], rx: number, ry: number): Record<string, { x: number; y: number }> {
  // Clockwise from the top: 0 at twelve o'clock, growing toward three o'clock.
  const angle = (p: { x: number; y: number }) => (Math.atan2(p.x - center.x, -(p.y - center.y)) + 2 * Math.PI) % (2 * Math.PI);
  const ordered = [...parts].sort((a, b) => angle(a) - angle(b) || a.id.localeCompare(b.id));
  return Object.fromEntries(
    ordered.map((p, i) => {
      const theta = ((-90 + (i * 360) / ordered.length) * Math.PI) / 180;
      return [p.id, { x: Math.round(center.x + rx * Math.cos(theta)), y: Math.round(center.y + ry * Math.sin(theta)) }];
    }),
  );
}
