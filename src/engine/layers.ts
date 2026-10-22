import type { SlotId } from "./schema";

/**
 * The layers of an app, as the canvas groups its parts and as the Learn page teaches them: the
 * app in the middle, where it runs above it, the people-facing services on one side, the data on
 * the other, and the outside services it calls below. A plan laid out this way reads as a system
 * design: every part sits with the parts it belongs with, and a line that crosses the diagram is
 * a line worth a second look. Pure, so the layout is tested without a canvas.
 */

export type LayerId = "runs" | "people" | "data" | "outside";
export type Side = "top" | "left" | "right" | "bottom";

export interface Layer {
  id: LayerId;
  label: string;
  /** One line, for the zone's tooltip. */
  what: string;
  slots: SlotId[];
  side: Side;
}

export const LAYERS: Layer[] = [
  { id: "runs", label: "Where it runs", what: "The server that runs your code, and the address people type.", slots: ["hosting", "domain"], side: "top" },
  { id: "people", label: "People", what: "What a person signs in with, pays with, gets email from, and holds in their hand.", slots: ["login", "payments", "email", "mobile"], side: "left" },
  { id: "data", label: "Data", what: "What the app keeps, and the work it does in the background.", slots: ["database", "files", "jobs"], side: "right" },
  { id: "outside", label: "Outside services", what: "Services your server calls: AI, other sites, automations, and the ones that watch the app.", slots: ["ai", "scraping", "data_apis", "automations", "analytics", "monitoring"], side: "bottom" },
];

const BY_SLOT = new Map<SlotId, Layer>(LAYERS.flatMap((layer) => layer.slots.map((slot) => [slot, layer] as const)));

/** The layer a part belongs to. The app itself (framework) is the middle, in no layer. */
export function layerOf(slot: SlotId): Layer | null {
  return BY_SLOT.get(slot) ?? null;
}

interface Spot {
  x: number;
  y: number;
}

/** A thing to place: a part, an extra service (in its part's layer) or a part added by hand (outside). */
export interface Placeable {
  id: string;
  layer: LayerId;
}

/** How far each side sits from the app, and how cards space out along it. Cards are about 170 by 56. */
const GAP_X = 236;
const GAP_Y = 92;
const TOP_Y = -250;
const BOTTOM_Y = 250;
const SIDE_X = 470;
/** Cards per row on the top and bottom, and per column on the sides, before a second row or column opens outward. */
const PER_LINE = 4;

/**
 * Every placeable on its layer's side of the app, centered on that side, in the order given. A
 * side with more than PER_LINE cards opens another row (top, bottom) or column (left, right)
 * farther out, so a big plan grows outward rather than overlapping.
 */
export function layeredLayout(items: Placeable[], center: Spot = { x: 0, y: 0 }): Record<string, Spot> {
  const spots: Record<string, Spot> = {};
  for (const layer of LAYERS) {
    const mine = items.filter((item) => item.layer === layer.id);
    mine.forEach((item, i) => {
      const line = Math.floor(i / PER_LINE);
      const inLine = Math.min(PER_LINE, mine.length - line * PER_LINE);
      const at = i % PER_LINE;
      const along = (at - (inLine - 1) / 2) * (layer.side === "top" || layer.side === "bottom" ? GAP_X : GAP_Y);
      const out = line * (layer.side === "top" || layer.side === "bottom" ? GAP_Y : GAP_X);
      const spot =
        layer.side === "top"
          ? { x: along, y: TOP_Y - out }
          : layer.side === "bottom"
            ? { x: along, y: BOTTOM_Y + out }
            : layer.side === "left"
              ? { x: -SIDE_X - out, y: along }
              : { x: SIDE_X + out, y: along };
      spots[item.id] = { x: Math.round(center.x + spot.x), y: Math.round(center.y + spot.y) };
    });
  }
  return spots;
}

/** The box around a layer's cards, with air around them, or null when the layer has none showing. */
export function layerBox(spots: { x: number; y: number; width: number; height: number }[], pad = 30, label = 26): { x: number; y: number; width: number; height: number } | null {
  if (spots.length === 0) return null;
  const left = Math.min(...spots.map((s) => s.x - s.width / 2)) - pad;
  const right = Math.max(...spots.map((s) => s.x + s.width / 2)) + pad;
  const top = Math.min(...spots.map((s) => s.y - s.height / 2)) - pad - label;
  const bottom = Math.max(...spots.map((s) => s.y + s.height / 2)) + pad;
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2), width: Math.round(right - left), height: Math.round(bottom - top) };
}
