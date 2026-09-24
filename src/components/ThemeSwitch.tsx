"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";

/**
 * Light, dark, or whatever the computer is set to (the default). The choice is kept in this
 * browser and set as data-theme on <html>, which theme-apple.css reads. THEME_SCRIPT runs before
 * the page paints, so a saved choice never flashes the other theme first.
 */

export type Theme = "system" | "light" | "dark";
const KEY = "whystack.theme";
const ORDER: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, string> = { system: "Match my computer", light: "Light", dark: "Dark" };

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const listeners = new Set<() => void>();
function read(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

/** The chosen theme, and what's showing now once "system" is resolved. */
export function useTheme(): { theme: Theme; resolved: "light" | "dark"; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  const systemDark = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-color-scheme: dark)").matches, () => false);
  const setTheme = useCallback((next: Theme) => {
    try {
      if (next === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
    } catch {
      // Private windows: the choice lasts until the tab closes.
    }
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    listeners.forEach((l) => l());
  }, []);
  return { theme, resolved: theme === "system" ? (systemDark ? "dark" : "light") : theme, setTheme };
}

/** One button that steps through Match my computer, Light and Dark. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button
      type="button"
      className={cx(className)}
      title={`Theme: ${LABEL[theme]}. Click for ${LABEL[next].toLowerCase()}.`}
      aria-label={`Theme: ${LABEL[theme]}`}
      onClick={() => setTheme(next)}
    >
      <Icon name={theme === "system" ? "auto" : theme === "light" ? "sun" : "moon"} size={16} />
    </button>
  );
}
