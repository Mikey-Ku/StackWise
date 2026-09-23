/**
 * Line icons in the spirit of SF Symbols: a 20px grid, 1.6px strokes, round caps. They inherit
 * the text color. Decorative unless given a title, because every button also has a label.
 */

const PATHS = {
  sparkle: "M10 2.5l1.6 4.3a2 2 0 0 0 1.2 1.2l4.2 1.5-4.2 1.5a2 2 0 0 0-1.2 1.2L10 16.5l-1.6-4.3a2 2 0 0 0-1.2-1.2L3 9.5l4.2-1.5a2 2 0 0 0 1.2-1.2z",
  overview: "M4 5h12M4 10h12M4 15h8",
  parts: "M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z",
  checklist: "M4 5.5l1.5 1.5L8 4.5M4 13l1.5 1.5L8 12M11 6h5.5M11 13.5h5.5",
  learn: "M10 5.5C8.5 4.3 6.3 4 3.5 4.2v10.5c2.8-.2 5 .1 6.5 1.3 1.5-1.2 3.7-1.5 6.5-1.3V4.2c-2.8-.2-5 .1-6.5 1.3zM10 5.5V16",
  undo: "M7 5L3.5 8.5 7 12M3.5 8.5H12a4.5 4.5 0 0 1 0 9H9",
  redo: "M13 5l3.5 3.5L13 12M16.5 8.5H8a4.5 4.5 0 0 0 0 9h3",
  close: "M5 5l10 10M15 5L5 15",
  chevron: "M8 5l5 5-5 5",
  down: "M5 8l5 5 5-5",
  plus: "M10 4v12M4 10h12",
  export: "M10 12.5V3M6.5 6.5L10 3l3.5 3.5M5 9.5H4v7.5h12V9.5h-1",
  send: "M10 16V4M5 9l5-5 5 5",
  terminal: "M3 4.5h14v11H3zM6 8l2.5 2L6 12M10.5 12.5H14",
  swap: "M4 7h11l-3-3M16 13H5l3 3",
  trash: "M4.5 6h11M8 6V4h4v2M6 6l.8 10h6.4L14 6",
  note: "M5 3.5h7l3 3v10H5zM12 3.5v3h3M7.5 10h5M7.5 13h3.5",
  target: "M10 3v3M10 14v3M3 10h3M14 10h3M10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
  fit: "M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4",
  wand: "M4 16L13 7M11.5 5.5l3 3M15 3v2M16 4h-2M5 5v2M6 6H4",
  info: "M10 9v5M10 6.2v.1M10 2.8a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4z",
  link: "M8.5 11.5l3-3M9.5 6.5l1.2-1.2a2.8 2.8 0 0 1 4 4l-1.2 1.2M10.5 13.5l-1.2 1.2a2.8 2.8 0 0 1-4-4l1.2-1.2",
  pin: "M10 17s5-4.6 5-8.5a5 5 0 0 0-10 0C5 12.4 10 17 10 17zM10 6.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  web: "M10 2.8a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4zM2.8 10h14.4M10 2.8c2 2 3 4.4 3 7.2s-1 5.2-3 7.2c-2-2-3-4.4-3-7.2s1-5.2 3-7.2z",
  phone: "M6.5 2.5h7a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM9 15h2",
  phones: "M3.5 4.5h6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1zM12.5 3.5h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4M6 14h1",
  cart: "M2.5 3.5h2l2 9h8.5l1.5-6.5H5.5M8 16.5h.1M14 16.5h.1",
  tool: "M12.5 3.5a3.5 3.5 0 0 0-3.3 4.6L3.5 13.8l2.7 2.7 5.7-5.7a3.5 3.5 0 0 0 4.6-3.3l-2 2-2.3-.4-.4-2.3z",
  minus: "M4 10h12",
  handle: "M7 5h.1M13 5h.1M7 10h.1M13 10h.1M7 15h.1M13 15h.1",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  return (
    <svg
      className={className}
      style={{ flex: "none" }}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
