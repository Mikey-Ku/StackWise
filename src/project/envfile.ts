/**
 * Reading and changing a project's env file, as text. Pure, so the rules are tested without a
 * file system. StackWise shows names and whether each has a value; values only ever go from the
 * person's typing into their own file, and from the file into a live check on this computer.
 * They never go back to the page, into a plan, a share link, an export or an AI.
 */

export interface EnvEntry {
  name: string;
  /** Whether it has a non-empty value. */
  set: boolean;
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/;
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function unquote(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  // An unquoted value ends at a comment.
  return value.replace(/\s+#.*$/, "");
}

/** Every name in the file, in order, and whether it has a value. */
export function parseEnv(text: string): EnvEntry[] {
  const seen = new Map<string, EnvEntry>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = line.match(LINE);
    if (match) seen.set(match[1], { name: match[1], set: unquote(match[2]).length > 0 });
  }
  return [...seen.values()];
}

/** The values, for live checks on this computer only. */
export function envValues(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = line.match(LINE);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return values;
}

/** Quote a value when the file would otherwise misread it. */
function quote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+,=?&-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The file with one name set. An existing line is replaced in place, so comments and order stay;
 * a new name is added at the end. An empty value keeps the name with nothing after it.
 */
export function setEnv(text: string, name: string, value: string): string {
  if (!ENV_NAME.test(name)) throw new Error(`"${name}" isn't a variable name.`);
  if (/[\r\n]/.test(value)) throw new Error("A value can't span lines.");
  const next = `${name}=${quote(value)}`;
  const lines = text.length ? text.split(/\r?\n/) : [];
  let replaced = false;
  const out = lines.map((line) => {
    const match = !/^\s*#/.test(line) && line.match(LINE);
    if (match && match[1] === name && !replaced) {
      replaced = true;
      return next;
    }
    return line;
  });
  if (!replaced) {
    while (out.length && out[out.length - 1] === "") out.pop();
    out.push(next);
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

/** Whether a .gitignore keeps a file out of git. Simple patterns only, which is what env files use. */
export function gitignoreCovers(gitignore: string | null, file: string): boolean {
  if (!gitignore) return false;
  return gitignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .some((pattern) => {
      const p = pattern.replace(/^\//, "");
      if (p === file) return true;
      if (!p.includes("*")) return false;
      const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return re.test(file);
    });
}

/** Env names a Spring config reads, from `${NAME}` and `${NAME:default}` placeholders. */
export function springEnvRefs(properties: string): string[] {
  const names = new Set<string>();
  for (const match of properties.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[^}]*)?\}/g)) names.add(match[1]);
  return [...names];
}

/** Show that a value exists without showing it: the first and last characters of longer values, stars for the rest. */
export function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 3)}${"•".repeat(Math.min(12, value.length - 5))}${value.slice(-2)}`;
}
