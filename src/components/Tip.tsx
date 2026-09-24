"use client";

import { cloneElement, useId, type ReactElement } from "react";

/**
 * A small styled tooltip for a control: its name, its shortcut, and one plain line on what it
 * does. Shown on hover (after a short pause) and on keyboard focus, never on a click. The control
 * points at it with aria-describedby, so screen readers hear the line too.
 */
export function Tip({ name, text, keys, children }: { name: string; text: string; keys?: string; children: ReactElement<{ "aria-describedby"?: string }> }) {
  const id = useId();
  return (
    <span className="ws-tip-wrap">
      {cloneElement(children, { "aria-describedby": id })}
      <span role="tooltip" id={id} className="ws-tip">
        <span className="ws-tip__head">
          <strong>{name}</strong>
          {keys && <kbd>{keys}</kbd>}
        </span>
        <span>{text}</span>
      </span>
    </span>
  );
}
