import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { edgePoint, wireEnds } from "./wire";

const card = (x: number, y: number, width = 200, height = 100) => ({ x, y, width, height });

describe("wire geometry", () => {
  it("leaves a card on the side facing the other card", () => {
    expect(edgePoint(card(0, 0), card(500, 0))).toEqual({ x: 200, y: 50, side: Position.Right });
    expect(edgePoint(card(0, 0), card(-500, 0))).toEqual({ x: 0, y: 50, side: Position.Left });
    expect(edgePoint(card(0, 0), card(0, 400))).toEqual({ x: 100, y: 100, side: Position.Bottom });
    expect(edgePoint(card(0, 0), card(0, -400))).toEqual({ x: 100, y: 0, side: Position.Top });
  });

  it("crosses the border where the line between the middles does, even on a slant", () => {
    const point = edgePoint(card(0, 0), card(300, 300));
    // The middle is (100, 50); heading down and right, a wide card is left through its bottom edge.
    expect(point.side).toBe(Position.Bottom);
    expect(point.y).toBe(100);
    expect(point.x).toBeCloseTo(150);
  });

  it("gives both ends of a line, and copes with cards on top of each other", () => {
    expect(wireEnds(card(0, 0), card(600, 0))).toMatchObject({ sourceX: 200, sourcePosition: Position.Right, targetX: 600, targetPosition: Position.Left });
    expect(edgePoint(card(0, 0), card(0, 0)).side).toBe(Position.Bottom);
  });
});
