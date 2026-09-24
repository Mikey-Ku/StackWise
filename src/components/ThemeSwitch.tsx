"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Icon } from "./icons";
import { Tip } from "./Tip";
import { cx } from "./ui";

/**
 * Light or dark. Until someone picks, StackWise follows the computer's setting; a click switches
 * to the other one and remembers it in this browser, set as data-theme on <html>, which
 * theme-apple.css reads. THEME_SCRIPT runs before the page paints, so a saved choice never
 * flashes the other theme first.
 */

export type Theme = "system" | "light" | "dark";
const KEY = "stackwise.theme";

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}")||localStorage.getItem("whystack.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

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

/** The saved theme ("system" until someone picks), and what's showing now. */
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

/** One button: shows what's on (a sun or a moon) and switches to the other. `tip` adds the dock's tooltip. */
export function ThemeSwitch({ className, tip = false }: { className?: string; tip?: boolean }) {
  const { resolved, setTheme } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  const button = (
    <button type="button" className={cx(className)} aria-label={`Switch to ${next} mode`} title={tip ? undefined : `Switch to ${next} mode`} onClick={() => setTheme(next)}>
      <Icon name={resolved === "dark" ? "moon" : "sun"} size={16} />
    </button>
  );
  return tip ? (
    <Tip name={resolved === "dark" ? "Dark mode" : "Light mode"} text={`Switch to ${next} mode. StackWise remembers it.`}>
      {button}
    </Tip>
  ) : (
    button
  );
}
