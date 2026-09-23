import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { arrangeInOrder, edgePoint, wireEnds } from "./wire";

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

describe("tidying without losing the person's order", () => {
  it("keeps the clockwise order around the app and spaces the parts evenly", () => {
    const parts = [
      { id: "left", x: -300, y: 10 },
      { id: "top", x: 5, y: -400 },
      { id: "right", x: 200, y: 0 },
      { id: "bottom", x: -20, y: 90 },
    ];
    const spots = arrangeInOrder({ x: 0, y: 0 }, parts, 400, 300);
    expect(spots.top).toEqual({ x: 0, y: -300 });
    expect(spots.right).toEqual({ x: 400, y: 0 });
    expect(spots.bottom).toEqual({ x: 0, y: 300 });
    expect(spots.left).toEqual({ x: -400, y: 0 });
  });
});
