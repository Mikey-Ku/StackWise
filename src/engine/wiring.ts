import { BUILD_ORDER, adaptEnvName } from "./checklist";
import { optionIn, type CatalogIndex } from "./evaluate";
import type { Extra, Selection, SlotId } from "./schema";
import type { CustomPart } from "./share";
import { possessive } from "./text";

/**
 * What runs between the parts of a stack. A connection on the canvas is the app reaching one
 * service, and what travels across it is a set of environment variables: the names the code reads
 * and the values only the person has. StackWise never holds a value, so everything here is names,
 * where each one comes from and whether it reaches the browser.
 */

/** Prefixes that make a variable readable by anyone who opens the app. Framework by framework. */
const BROWSER_PREFIXES = ["NEXT_PUBLIC_", "PUBLIC_", "VITE_", "EXPO_PUBLIC_", "REACT_APP_"];

export interface EnvVar {
  name: string;
  slot: SlotId;
  optionId: string;
  optionName: string;
  /** The setup step that hands you the value. */
  step: string;
  source?: string;
  /** True when the framework's prefix puts this value in the browser, so it can't be a secret. */
  browser: boolean;
  /** Set when it belongs to an extra service ("database.cache"). */
  instance?: string;
}

export interface Connection {
  id: string;
  slot: SlotId;
  /** The slot's verb, like "stores data in". */
  label: string;
  optionId: string;
  optionName: string;
  env: EnvVar[];
  /** Hosting carries every variable in the plan, because the host has to have them all. */
  everything: boolean;
  /** False when nobody has researched this service's setup, so an empty list means nothing. */
  stepsKnown: boolean;
  /** One plain sentence for the panel, and for anyone reading the exported files. */
  what: string;
  /** Set on the line to an extra service ("database.cache"). */
  instance?: string;
}

export function isBrowserEnv(name: string): boolean {
  return BROWSER_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function list(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Every environment variable the plan needs, in setup order, each one traced back to the step that
 * gives you its value. A name that two services share is kept once, under the first that asks.
 */
export function planEnv(index: CatalogIndex, selection: Selection, extras: Record<string, Extra> = {}): EnvVar[] {
  const vars: EnvVar[] = [];
  const seen = new Set<string>();
  for (const slot of BUILD_ORDER) {
    const option = optionIn(index, selection, slot);
    if (!option) continue;
    for (const step of option.setup) {
      for (const raw of step.env) {
        const name = adaptEnvName(raw, selection.framework);
        if (seen.has(name)) continue;
        seen.add(name);
        vars.push({
          name,
          slot,
          optionId: option.id,
          optionName: option.name,
          step: step.step,
          source: /^https?:\/\//.test(step.source) ? step.source : undefined,
          browser: isBrowserEnv(name),
        });
      }
    }
  }
  // An extra's variables follow. A name the plan already uses gets the extra's role in front
  // (a second DATABASE_URL becomes CACHE_DATABASE_URL), so both values fit in one env file.
  for (const [id, extra] of Object.entries(extras)) {
    const option = index.optionsById.get(extra.option);
    if (!option) continue;
    const prefix = (extra.role || id.split(".")[1] || "extra").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    for (const step of option.setup) {
      for (const raw of step.env) {
        const adapted = adaptEnvName(raw, selection.framework);
        let name = adapted;
        if (seen.has(name)) {
          // Keep a browser prefix in front, so NEXT_PUBLIC_X becomes NEXT_PUBLIC_CACHE_X and stays public.
          const browserPrefix = BROWSER_PREFIXES.find((p) => adapted.startsWith(p)) ?? "";
          name = `${browserPrefix}${prefix}_${adapted.slice(browserPrefix.length)}`;
        }
        if (seen.has(name)) continue;
        seen.add(name);
        vars.push({
          name,
          slot: extra.slot,
          optionId: option.id,
          optionName: `${option.name} (${extra.role || id})`,
          step: step.step,
          source: /^https?:\/\//.test(step.source) ? step.source : undefined,
          browser: isBrowserEnv(name),
          instance: id,
        });
      }
    }
  }
  return vars;
}

export function envForSlot(vars: EnvVar[], slot: SlotId, instance?: string): EnvVar[] {
  return vars.filter((v) => v.slot === slot && v.instance === instance);
}

/** The lines between the app and each part it uses, with what travels along them. */
export function connectionsOf(index: CatalogIndex, selection: Selection, extras: Record<string, Extra> = {}): Connection[] {
  const vars = planEnv(index, selection, extras);
  const extraLines = Object.entries(extras).flatMap(([id, extra]): Connection[] => {
    const option = index.optionsById.get(extra.option);
    const def = index.slotsById.get(extra.slot);
    if (!option || !def) return [];
    const mine = envForSlot(vars, extra.slot, id);
    const names = mine.map((v) => v.name);
    const what = `Your app ${def.verb} ${option.name} for ${extra.role || id}.${names.length ? ` Your code reads ${list(names)} to reach it.` : ""}`;
    return [{ id: `app-${id}`, slot: extra.slot, label: extra.role || def.verb, optionId: option.id, optionName: option.name, env: mine, everything: false, stepsKnown: option.setup.length > 0, what, instance: id }];
  });
  const primary = BUILD_ORDER.filter((slot) => slot !== "framework").flatMap((slot) => {
    const option = optionIn(index, selection, slot);
    const def = index.slotsById.get(slot);
    if (!option || !def) return [];
    // One service in two parts (PostHog for analytics and monitoring) has its variables listed
    // once, under the first part; the second line carries the same ones.
    const own = envForSlot(vars, slot);
    const mine = own.length ? own : vars.filter((v) => v.optionId === option.id && !v.instance);
    const everything = slot === "hosting";
    const stepsKnown = option.setup.length > 0;
    const names = mine.map((v) => v.name);
    const opening = `Your app ${def.verb} ${option.name}.`;
    const what = everything
      ? `${opening} Every variable in this plan has to be added in ${possessive(option.name)} settings as well, or the deployed app can't reach the rest of the stack.`
      : names.length > 0
        ? `${opening} Your code reads ${list(names)} to reach it.`
        : stepsKnown
          ? `${opening} No environment variable is written down for it, so read its setup steps before you build.`
          : `${opening} Nobody has researched its setup yet, so StackWise can't say what it needs.`;
    return [{ id: `app-${slot}`, slot, label: def.verb, optionId: option.id, optionName: option.name, env: mine, everything, stepsKnown, what }];
  });
  return [...primary, ...extraLines];
}

/** The short label on the line itself: the verb, plus what it carries when there's room. */
export function connectionLabel(connection: Connection, all: EnvVar[]): string {
  const carried = connection.everything ? all : connection.env;
  if (carried.length === 0) return connection.label;
  if (connection.everything || carried.length > 2) return `${connection.label}: ${carried.length} variables`;
  return `${connection.label}: ${carried.map((v) => v.name).join(", ")}`;
}

/**
 * The body of `.env.local` and `.env.example`: names grouped by service, with the step that gives
 * you each value and a link to the docs. Values are always empty. StackWise never writes a secret.
 */
/** Text for a `#` comment line: a newline in it would start a line of its own, maybe a VAR=value. */
const comment = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ");

export function envFileText(vars: EnvVar[], details: { appName: string; generatedOn: string; custom?: Record<string, CustomPart> }): string {
  const name = comment(details.appName.trim() || "this app");
  const lines = [
    `# Environment variables for ${name}`,
    `# Planned with StackWise on ${details.generatedOn}. Names only: fill in the values yourself.`,
    "# Keep this file out of git. Anything with a public prefix is readable by everyone who opens the app.",
  ];
  const own = Object.values(details.custom ?? {}).filter((part) => part.env.length > 0);
  if (vars.length === 0 && own.length === 0) {
    lines.push("", "# No service in this plan needs a variable yet.");
    return `${lines.join("\n")}\n`;
  }
  for (const optionId of [...new Set(vars.map((v) => v.optionId))]) {
    const group = vars.filter((v) => v.optionId === optionId);
    lines.push("", `# ${comment(group[0].optionName)}`);
    for (const step of [...new Set(group.map((v) => v.step))]) {
      const here = group.filter((v) => v.step === step);
      lines.push(`# ${comment(step)}`);
      if (here[0].source) lines.push(`# ${comment(here[0].source)}`);
      for (const v of here) lines.push(`${v.name}=`);
    }
  }
  const written = new Set(vars.map((v) => v.name));
  for (const part of own) {
    const names = part.env.filter((name) => !written.has(name));
    if (names.length === 0) continue;
    lines.push("", `# ${comment(part.name)} (your own part: StackWise has no facts on it)`, ...(part.url ? [`# ${comment(part.url)}`] : []), ...names.map((name) => `${name}=`));
    for (const name of names) written.add(name);
  }
  return `${lines.join("\n")}\n`;
}
