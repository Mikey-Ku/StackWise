"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";

/**
 * A right-click menu in the macOS style: frosted, keyboard driven, with one level of submenus.
 * It opens at the pointer, moves itself back inside the window, and closes on Escape, on a click
 * anywhere else, on scroll, and after an item is chosen. It renders into the body, because a
 * floating panel's transform would otherwise trap a fixed-position menu inside it.
 */

export type MenuItem =
  | { kind?: "item"; label: string; icon?: IconName; lead?: ReactNode; hint?: string; checked?: boolean; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: "submenu"; label: string; icon?: IconName; items: MenuItem[]; disabled?: boolean }
  | { kind: "separator" }
  | { kind: "header"; label: string };

export interface MenuRequest {
  x: number;
  y: number;
  items: MenuItem[];
}

const focusables = (root: HTMLElement | null) => (root ? [...root.querySelectorAll<HTMLButtonElement>(":scope > li > [role=menuitem]:not([disabled])")] : []);

function MenuList({ items, onClose, onBack, autoFocus, className }: { items: MenuItem[]; onClose: () => void; onBack?: () => void; autoFocus: boolean; className?: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (autoFocus) focusables(ref.current)[0]?.focus();
    // A submenu that would run off the right edge opens to the left instead, before it's painted.
    const box = ref.current?.getBoundingClientRect();
    if (box && box.right > window.innerWidth - 8) ref.current?.classList.add("is-flipped");
  }, [autoFocus]);

  const move = (delta: number) => {
    const list = focusables(ref.current);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(at + delta + list.length) % list.length]?.focus();
  };

  return (
    <ul
      ref={ref}
      role="menu"
      className={cx("ws-cmenu", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") move(1);
        else if (e.key === "ArrowUp") move(-1);
        else if (e.key === "ArrowLeft" && onBack) onBack();
        else if (e.key === "Escape") (onBack ?? onClose)();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((item, i) => {
        if (item.kind === "separator") return <li key={i} role="separator" className="ws-cmenu__sep" />;
        if (item.kind === "header") {
          return (
            <li key={i} role="presentation" className="ws-cmenu__header">
              {item.label}
            </li>
          );
        }
        if (item.kind === "submenu") {
          const isOpen = open === i;
          return (
            <li key={i} role="none" className="ws-cmenu__li" onMouseEnter={() => !item.disabled && setOpen(i)} onMouseLeave={() => setOpen((v) => (v === i ? null : v))}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                disabled={item.disabled}
                className={cx("ws-cmenu__item", isOpen && "is-open")}
                onClick={() => setOpen(i)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(i);
                  }
                }}
              >
                <span className="ws-cmenu__icon">{item.icon && <Icon name={item.icon} size={15} />}</span>
                <span className="ws-cmenu__label">{item.label}</span>
                <Icon name="chevron" size={12} className="ws-cmenu__chev" />
              </button>
              {isOpen && (
                <MenuList
                  items={item.items}
                  onClose={onClose}
                  autoFocus={false}
                  className="ws-cmenu--sub"
                  onBack={() => {
                    setOpen(null);
                    focusables(ref.current)
                      .find((b) => b.getAttribute("aria-expanded") === "true")
                      ?.focus();
                  }}
                />
              )}
            </li>
          );
        }
        return (
          <li key={i} role="none" className="ws-cmenu__li" onMouseEnter={() => setOpen(null)}>
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cx("ws-cmenu__item", item.danger && "is-danger")}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              <span className="ws-cmenu__icon">{item.checked ? <span className="ws-cmenu__check" aria-label="current">{"✓"}</span> : item.lead ?? (item.icon && <Icon name={item.icon} size={15} />)}</span>
              <span className="ws-cmenu__label">{item.label}</span>
              {item.hint && <span className="ws-cmenu__hint">{item.hint}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ContextMenu({ request, onClose }: { request: MenuRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // The menu renders at the pointer, then moves back inside the window before it's painted.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!request || !el) return;
    const box = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(request.x, window.innerWidth - box.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(request.y, window.innerHeight - box.height - 8))}px`;
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const outside = (e: Event) => !(e.target instanceof Node && ref.current?.contains(e.target));
    const onPointer = (e: PointerEvent) => {
      if (outside(e)) onClose();
    };
    // Scrolling a long submenu is fine; scrolling or zooming the canvas closes the menu.
    const onWheel = (e: WheelEvent) => {
      if (outside(e)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("wheel", onWheel);
    };
  }, [request, onClose]);

  if (!request) return null;
  return createPortal(
    <div
      ref={ref}
      className="ws-cmenu-root"
      style={{ left: request.x, top: request.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList key={`${request.x},${request.y}`} items={request.items} onClose={onClose} autoFocus />
    </div>,
    document.body,
  );
}
