import { describe, expect, it } from "vitest";
import { LAYERS, layerBox, layeredLayout, layerOf } from "./layers";
import { SLOT_IDS } from "./schema";

describe("layers", () => {
  it("puts every part except the app itself in exactly one layer", () => {
    const seen = new Map<string, number>();
    for (const layer of LAYERS) for (const slot of layer.slots) seen.set(slot, (seen.get(slot) ?? 0) + 1);
    for (const slot of SLOT_IDS) {
      if (slot === "framework") expect(layerOf(slot)).toBeNull();
      else expect(seen.get(slot)).toBe(1);
    }
  });

  it("places each layer on its own side of the app, evenly, with no two cards on one spot", () => {
    const spots = layeredLayout([
      { id: "hosting", layer: "runs" },
      { id: "domain", layer: "runs" },
      { id: "login", layer: "people" },
      { id: "database", layer: "data" },
      { id: "extra-database.cache", layer: "data" },
      { id: "ai", layer: "outside" },
      { id: "custom-1", layer: "outside" },
    ]);
    expect(spots.hosting.y).toBeLessThan(0);
    expect(spots.domain.y).toBe(spots.hosting.y);
    expect(spots.hosting.x).toBe(-spots.domain.x);
    expect(spots.login.x).toBeLessThan(0);
    expect(spots.database.x).toBeGreaterThan(0);
    expect(spots["extra-database.cache"].x).toBe(spots.database.x);
    expect(spots.ai.y).toBeGreaterThan(0);
    const all = Object.values(spots).map((s) => `${s.x},${s.y}`);
    expect(new Set(all).size).toBe(all.length);
  });

  it("opens a second row outward when a side is full, and follows the app when it moved", () => {
    const six = layeredLayout(["ai", "scraping", "data_apis", "automations", "analytics", "monitoring"].map((id) => ({ id, layer: "outside" as const })), { x: 100, y: 50 });
    const rows = new Set(Object.values(six).map((s) => s.y));
    expect(rows.size).toBe(2);
    expect(Math.min(...rows)).toBe(50 + 250);
    expect(six.analytics.y).toBeGreaterThan(six.ai.y);
  });

  it("draws a box around a layer's cards with room for its label, and none for an empty layer", () => {
    expect(layerBox([])).toBeNull();
    const box = layerBox([
      { x: 0, y: 0, width: 170, height: 56 },
      { x: 236, y: 0, width: 170, height: 56 },
    ]);
    expect(box).toEqual({ x: 118, y: -13, width: 466, height: 142 });
  });
});
