"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";
import { Icon, type IconName } from "./icons";
import { ThemeSwitch } from "./ThemeSwitch";
import { cx } from "./ui";

/**
 * The shell around every page that isn't the canvas: a sidebar with who you are, where your
 * plans live and the pages, and a scrolling main column. The canvas itself stays full screen
 * with its own bar; "Open the canvas" goes back to it.
 */

export interface Me {
  profile: { name: string; builderId: string; priority: string; size: string; answerer: string; theme: string; folders: string[] };
  dir: string;
  home: string;
  account: string;
}

/** Your profile from ~/.stackwise, or null until it's loaded or when the server is away. */
export function useMe(initial: Me | null = null): [Me | null, (me: Me) => void] {
  const [me, setMe] = useState<Me | null>(initial);
  useEffect(() => {
    // A page rendered with the profile already has it.
    if (initial) return;
    let stopped = false;
    fetch("/api/profile", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Me | null) => {
        if (!stopped && body) setMe(body);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [initial]);
  return [me, setMe];
}

/** A path under the home folder, written with ~. */
export const shortPath = (p: string, home: string | undefined) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/projects", label: "Projects", icon: "grid" },
  { href: "/learn", label: "Learn", icon: "learn" },
  { href: "/docs", label: "Documentation", icon: "info" },
  { href: "/review", label: "Review facts", icon: "checklist" },
];

/** A page's own sections, shown in the sidebar under the pages: Settings' Account, General and so on. */
export interface ShellSections {
  title: string;
  items: { id: string; label: string; href: string; active?: boolean; icon?: IconName; onSelect?: () => void }[];
}

export function Shell({ me, sections, children }: { me: Me | null; sections?: ShellSections; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const name = me?.profile.name.trim() || me?.account || "";
  const initial = (name || "S").slice(0, 1).toUpperCase();
  return (
    <div className="shell">
      <aside className="shell-side">
        <Link href="/" className="shell-brand" aria-label="StackWise, open the canvas">
          <BrandMark size={22} />
          StackWise
        </Link>
        <div className="shell-me" title={me ? me.dir : undefined}>
          <span className="shell-avatar" aria-hidden>
            {initial}
          </span>
          <span className="shell-me__text">
            <strong>{name || "Loading"}</strong>
            <span>{me ? shortPath(me.dir, me.home) : " "}</span>
          </span>
        </div>
        <nav className="shell-nav" aria-label="Pages">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={cx("shell-nav__item", pathname.startsWith(item.href) && "is-on")} aria-current={pathname.startsWith(item.href) ? "page" : undefined}>
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        {sections && (
          <nav className="shell-subnav" aria-label={sections.title}>
            <p className="shell-subnav__title">{sections.title}</p>
            {sections.items.map((item) =>
              item.onSelect ? (
                <button key={item.id} type="button" className={cx("shell-nav__item shell-subnav__item", item.active && "is-on")} aria-current={item.active ? "page" : undefined} onClick={item.onSelect}>
                  {item.icon && <Icon name={item.icon} size={15} />}
                  <span>{item.label}</span>
                </button>
              ) : (
                <Link key={item.id} href={item.href} className={cx("shell-nav__item shell-subnav__item", item.active && "is-on")} aria-current={item.active ? "page" : undefined}>
                  {item.icon && <Icon name={item.icon} size={15} />}
                  <span>{item.label}</span>
                </Link>
              ),
            )}
          </nav>
        )}
        <div className="shell-side__foot">
          <a href="https://github.com/Mikey-Ku/StackWise" target="_blank" rel="noreferrer" className="shell-nav__item" title="The code, on GitHub">
            <Icon name="web" size={16} />
            <span>GitHub</span>
          </a>
          <Link href="/settings" className={cx("shell-nav__item", pathname.startsWith("/settings") && "is-on")} aria-current={pathname.startsWith("/settings") ? "page" : undefined}>
            <Icon name="tool" size={16} />
            <span>Settings</span>
          </Link>
          <div className="shell-side__row">
            <Link href="/" className="mk-btn mk-btn--primary mk-sm shell-open">
              Open the canvas
            </Link>
            <ThemeSwitch className="mk-btn mk-btn--ghost mk-sm shell-theme" />
          </div>
        </div>
      </aside>
      <main className="shell-main">{children}</main>
    </div>
  );
}
