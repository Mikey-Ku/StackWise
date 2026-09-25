"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Advanced tools: the project folder panel, a second service in a part, lines between parts, and
 * building a part yourself. Off by default so a first plan shows only the core loop (describe,
 * see the plan, understand it, export). Things already on the canvas stay on the canvas either
 * way; this only hides the ways to add more. Kept in this browser.
 */
const KEY = "stackwise.advanced";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAdvanced(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    try {
      if (next) window.localStorage.setItem(KEY, "on");
      else window.localStorage.removeItem(KEY);
    } catch {
      // Private windows: the choice lasts until the tab closes.
    }
    listeners.forEach((l) => l());
  }, []);
  return [on, set];
}
