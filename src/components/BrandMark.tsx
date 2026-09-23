/**
 * The StackWise mark: a stack of layers, with a magnifying glass looking into the top one. The
 * stack is the app's parts; the glass is StackWise checking how they connect. The favicon
 * (src/app/icon.svg) is the same drawing.
 */
export function BrandMark({ size = 22, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1254 1254" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} style={{ flex: "none" }}>
      {title && <title>{title}</title>}
      <rect width="1254" height="1254" rx="270" fill="#0561ee" />
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
        <path d="M627 337 L933 520 L627 703 L322 520 Z" strokeWidth="62" />
        <path d="M322 668 L627 848 L932 668" strokeWidth="64" />
        <path d="M322 792 L627 967 L932 792" strokeWidth="64" />
        <circle cx="607" cy="517" r="88" strokeWidth="34" />
        <path d="M562 520 a46 46 0 0 1 40 -40" strokeWidth="20" />
        <path d="M692 570 L735 604" stroke="#0561ee" strokeWidth="92" />
        <path d="M692 570 L735 604" strokeWidth="46" />
      </g>
    </svg>
  );
}
