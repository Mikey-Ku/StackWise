import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { QueryArrayConfig } from "pg";
import { detectProject, type Detected } from "./detect";
import { envValues, gitignoreCovers, parseEnv, setEnv, springEnvRefs } from "./envfile";
import { buildProbe, PROBES, safeBody } from "./probes";
import { checkReadOnly, postgresFrom, ROW_LIMIT, sqliteFrom, TIMEOUT_MS } from "./sql";
import { LEGACY_PLAN_FILE, PLAN_FILE } from "@/engine/names";

/**
 * Node-only. A project folder on this computer, linked to a plan: what it is, its env files,
 * live checks, the read-only SQL console and the processes StackWise runs for it. Every route
 * that calls this answers only this computer (see src/mcp/local.ts) and only for folders
 * resolveFolder allows. Values from env files are used here and never returned.
 */

const WRITE_TO = ".env.local";

function read(folder: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join(folder, file), "utf8");
  } catch {
    return null;
  }
}

export interface EnvRow {
  name: string;
  set: boolean;
  /** Which files name it. */
  files: string[];
}

export interface Inspection extends Detected {
  folder: string;
  exists: boolean;
  env: EnvRow[];
  /** Names the app's config reads (Spring's ${NAME} placeholders). */
  configRefs: string[];
  /** Whether git keeps .env.local out of commits. */
  envIgnored: boolean;
  /** Whether the project has a StackWise plan file. */
  planFile: boolean;
  /** Things that will stop it running or leak something, in plain words. */
  issues: string[];
  /** The app's own icon, relative to the folder, when StackWise found one. */
  icon: string | null;
  /** The opening of the project's README, as a starting description for a new plan. */
  readme: string | null;
}

/** The first paragraphs of a README, without headings, badges, code or links, cut to a readable length. */
export function readmeSummary(text: string | null, limit = 700): string | null {
  if (!text) return null;
  const paragraphs = text
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("![") && !p.startsWith("[!") && !p.startsWith("<"))
    .map((p) => p.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " "));
  let out = "";
  for (const p of paragraphs) {
    if (out && out.length + p.length > limit) break;
    out = out ? `${out} ${p}` : p;
  }
  return out ? out.slice(0, limit) : null;
}

const ICON_TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const WEB_ROOTS = ["public", "static", "src/main/resources/static", "app/static", "src/app", "app", "web", "wwwroot", "assets", ""];
const ICON_NAMES = ["icon.svg", "icon.png", "logo.svg", "logo.png", "apple-touch-icon.png", "favicon.svg", "favicon.png", "favicon.ico"];

/** The app's icon: what its HTML links to first, then the usual file names in the usual folders. */
export function findIcon(folder: string): string | null {
  const has = (file: string) => fs.existsSync(path.join(folder, file));
  for (const root of WEB_ROOTS) {
    for (const page of ["index.html", "templates/index.html"]) {
      // Paths in the person's project, not files StackWise ships with: the build's file tracing skips them.
      const html = read(folder, path.join(/* turbopackIgnore: true */ root, page));
      const href = html?.match(/<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*href=["']([^"'?#]+)/i)?.[1] ?? html?.match(/<link[^>]+href=["']([^"'?#]+)["'][^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["']/i)?.[1];
      if (href && !/^(https?:|data:|\/\/)/.test(href)) {
        const file = path.join(/* turbopackIgnore: true */ root, href.replace(/^\//, ""));
        if (has(file) && ICON_TYPES[path.extname(file).toLowerCase()]) return file;
      }
    }
    for (const name of ICON_NAMES) if (has(path.join(/* turbopackIgnore: true */ root, name))) return path.join(/* turbopackIgnore: true */ root, name);
  }
  return null;
}

/** An icon from the project as a data URL, small enough to keep with the plan in the browser. */
export function iconData(folder: string, file: string): string | null {
  const type = ICON_TYPES[path.extname(file).toLowerCase()];
  // Followed through symlinks: an icon that links to a file elsewhere is never read.
  const full = type ? inside(folder, file) : null;
  if (!full) return null;
  try {
    const bytes = fs.readFileSync(full);
    if (bytes.length > 256 * 1024) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** A JDK of a given major version on this Mac: Homebrew's first, then the system's. */
export function findJdk(version: string): string | null {
  const candidates = [
    `/opt/homebrew/opt/openjdk@${version}/libexec/openjdk.jdk/Contents/Home`,
    `/usr/local/opt/openjdk@${version}/libexec/openjdk.jdk/Contents/Home`,
  ];
  try {
    for (const name of fs.readdirSync("/Library/Java/JavaVirtualMachines")) {
      if (new RegExp(`(^|[^0-9])${version}([^0-9]|$)`).test(name)) candidates.push(`/Library/Java/JavaVirtualMachines/${name}/Contents/Home`);
    }
  } catch {
    // No system JDKs.
  }
  return candidates.find((home) => fs.existsSync(path.join(home, "bin", "java"))) ?? null;
}

export function inspect(folder: string): Inspection {
  const exists = fs.existsSync(folder) && fs.statSync(folder).isDirectory();
  const has = (file: string) => fs.existsSync(path.join(folder, file));
  const detected = exists ? detectProject(has, (file) => read(folder, file)) : { framework: null, label: "Missing folder", commands: [] as { label: string; command: string }[], healthUrl: null, envFiles: [], configFiles: [] };
  const rows = new Map<string, EnvRow>();
  for (const file of detected.envFiles) {
    for (const entry of parseEnv(read(folder, file) ?? "")) {
      const row = rows.get(entry.name) ?? { name: entry.name, set: false, files: [] };
      row.set ||= entry.set;
      row.files.push(file);
      rows.set(entry.name, row);
    }
  }
  const configRefs = detected.configFiles.flatMap((file) => springEnvRefs(read(folder, file) ?? ""));
  const envIgnored = gitignoreCovers(read(folder, ".gitignore"), WRITE_TO);
  const issues: string[] = [];
  let commands = detected.commands;
  if (detected.javaVersion) {
    const jdk = findJdk(detected.javaVersion);
    if (jdk) {
      // Point the build at the right Java, whatever the default is.
      commands = commands.map((c) => (c.command.startsWith("./mvnw") || c.command.startsWith("./gradlew") ? { ...c, command: `JAVA_HOME=${jdk} ${c.command}` } : c));
    } else issues.push(`This project needs Java ${detected.javaVersion}, and StackWise couldn't find it on this Mac. Install it with: brew install openjdk@${detected.javaVersion}`);
  }
  if (rows.size && !envIgnored && has(WRITE_TO)) issues.push("Git doesn't ignore .env.local, so your keys could be committed. Add .env.local to .gitignore.");
  return { ...detected, commands, folder, exists, env: [...rows.values()], configRefs: [...new Set(configRefs)], envIgnored, planFile: has(PLAN_FILE) || has(LEGACY_PLAN_FILE), issues, icon: exists ? findIcon(folder) : null, readme: exists ? readmeSummary(read(folder, "README.md") ?? read(folder, "readme.md")) : null };
}

/** Every value the project's env files set, later files winning, the way most frameworks load them. */
export function projectEnv(folder: string): Record<string, string> {
  const files = [".env", ".env.development", ".env.local", ".env.development.local"];
  return Object.assign({}, ...files.map((file) => envValues(read(folder, file) ?? "")));
}

/** Set one variable in the project's .env.local. The file is created readable only by you. */
export function writeEnv(folder: string, name: string, value: string): { created: boolean; ignored: boolean } {
  const file = path.join(folder, WRITE_TO);
  // A .env.local that links somewhere else would have the key written to wherever it points.
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(".env.local is a link to another file, so StackWise won't write to it.");
  const before = read(folder, WRITE_TO);
  fs.writeFileSync(file, setEnv(before ?? "", name, value), { mode: 0o600 });
  // The mode above only applies to a new file; an existing one is made private too.
  fs.chmodSync(file, 0o600);
  return { created: before === null, ignored: gitignoreCovers(read(folder, ".gitignore"), WRITE_TO) };
}

export interface ProbeResult {
  id: string;
  title: string;
  ok: boolean;
  status?: number;
  ms?: number;
  request?: { url: string; headers: Record<string, string> };
  body?: string;
  missing?: string[];
  error?: string;
  statusPage?: string;
  sample?: { sends: unknown; gets: unknown };
}

async function get(url: string, headers: Record<string, string>, secrets: string[]) {
  const started = Date.now();
  const response = await fetch(url, { method: "GET", headers: { "user-agent": "StackWise/0.1 (local check)", ...headers }, signal: AbortSignal.timeout(8000), redirect: "manual" });
  const text = await response.text();
  return { status: response.status, ms: Date.now() - started, body: safeBody(text, secrets) };
}

/** One live check: a service in the plan, or "app" for the running app's own health page. */
export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function probe(folder: string, id: string, healthUrl?: string | null): Promise<ProbeResult> {
  if (id === "app") {
    const url = healthUrl ?? inspect(folder).healthUrl;
    if (!url) return { id, title: "Your app answers", ok: false, error: "StackWise doesn't know where this app answers yet." };
    // The app check only ever calls this computer; StackWise isn't a way to fetch other sites.
    if (!isLoopbackUrl(url)) return { id, title: "Your app answers", ok: false, error: "The app check only calls addresses on this computer, like http://localhost:3000." };
    try {
      const result = await get(url, {}, []);
      return { id, title: "Your app answers", ok: result.status < 400, ...result, request: { url, headers: {} } };
    } catch {
      return { id, title: "Your app answers", ok: false, request: { url, headers: {} }, error: "Nothing answered. Start the app, or check its port." };
    }
  }
  const def = PROBES[id];
  if (!def) return { id, title: "No live check yet", ok: false, error: "StackWise has no read-only check for this service yet." };
  const built = buildProbe(def, projectEnv(folder));
  const base = { id, title: def.title, statusPage: def.statusPage, sample: def.sample };
  if ("missing" in built) return { ...base, ok: false, missing: built.missing, error: `Set ${built.missing.join(" and ")} first.` };
  try {
    const result = await get(built.url, built.headers, built.secrets);
    return { ...base, ok: result.status < 400, ...result, request: built.shown };
  } catch {
    return { ...base, ok: false, request: built.shown, error: "The service didn't answer in 8 seconds." };
  }
}

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  ms: number;
  database: string;
}

/** A path inside the folder, following symlinks, or null when it lands outside. */
export function inside(folder: string, relative: string): string | null {
  try {
    const root = fs.realpathSync(folder);
    const full = fs.realpathSync(path.resolve(folder, relative));
    return full === root || full.startsWith(root + path.sep) ? full : null;
  } catch {
    return null;
  }
}

/**
 * SQLite runs synchronously, and a runaway query (a recursive one that never ends) can't be
 * interrupted from JavaScript, not even by stopping a worker thread. So each query runs in its own
 * short-lived Node process, killed after TIMEOUT_MS, and stops reading rows after ROW_LIMIT.
 */
const SQLITE_SCRIPT = `
const { DatabaseSync } = require("node:sqlite");
const [file, query, limit] = process.argv.slice(1);
try {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = [];
  let more = false;
  for (const row of db.prepare(query).iterate()) {
    if (rows.length >= Number(limit)) { more = true; break; }
    rows.push({ ...row });
  }
  db.close();
  process.stdout.write(JSON.stringify({ rows, more }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: String((error && error.message) || error) }));
}`;

function sqliteQuery(file: string, query: string): Promise<{ rows: Record<string, unknown>[]; more: boolean } | { error: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["-e", SQLITE_SCRIPT, file, query, String(ROW_LIMIT)],
      { timeout: TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024, env: childEnv() },
      (error, stdout) => {
        if (error && (error.killed || error.signal)) return resolve({ error: `The query took longer than ${TIMEOUT_MS / 1000} seconds, so it was stopped.` });
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ error: "The query failed." });
        }
      },
    );
  });
}

/** One read-only query against the project's database. */
export async function runSql(folder: string, query: string): Promise<SqlResult | { error: string }> {
  const refused = checkReadOnly(query);
  if (refused) return { error: refused };
  const env = projectEnv(folder);
  const started = Date.now();
  const pg = postgresFrom(env);
  if (pg) {
    const { Client } = await import("pg");
    // The whole session is read-only, not just the transaction, so a COMMIT smuggled into the query can't end it.
    const client = new Client({
      ...pg.config,
      statement_timeout: TIMEOUT_MS,
      connectionTimeoutMillis: TIMEOUT_MS,
      application_name: "StackWise read-only",
      options: "-c default_transaction_read_only=on",
    });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      // The extended protocol runs exactly one statement: "SELECT 1; COMMIT; DELETE ..." is refused by Postgres itself.
      const config: QueryArrayConfig & { queryMode: "extended" } = { text: query, rowMode: "array", queryMode: "extended" };
      const result = await client.query(config);
      await client.query("ROLLBACK");
      const rows = (result.rows as unknown[][]).slice(0, ROW_LIMIT);
      return { columns: result.fields.map((f) => f.name), rows, truncated: result.rows.length > ROW_LIMIT, ms: Date.now() - started, database: `Postgres (${pg.from})` };
    } catch (error) {
      return { error: error instanceof Error ? error.message.replace(pg.config.connectionString, "(the database URL)") : "The query failed." };
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  const file = sqliteFrom(env);
  if (file) {
    const full = inside(folder, file);
    if (!full) return { error: "That database file is outside the project." };
    const result = await sqliteQuery(full, query);
    if ("error" in result) return result;
    const columns = result.rows[0] ? Object.keys(result.rows[0]) : [];
    return { columns, rows: result.rows.map((r) => columns.map((c) => r[c])), truncated: result.more, ms: Date.now() - started, database: `SQLite (${file})` };
  }
  return { error: "StackWise found no Postgres URL (DATABASE_URL or SPRING_DATASOURCE_URL) or SQLite file in this project's env files. A database that lives inside the app, like an H2 file inside the app, can only be read by the app itself." };
}

/* ---------- processes StackWise runs ---------- */

export interface RunInfo {
  id: string;
  folder: string;
  command: string;
  startedAt: string;
  running: boolean;
  exitCode: number | null;
  lines: number;
}

interface Run extends RunInfo {
  child: ChildProcess;
  log: string[];
}

const LOG_LIMIT = 1000;
// Kept on globalThis so a hot reload in development doesn't lose track of running processes.
const runs: Map<string, Run> = ((globalThis as { __stackwiseRuns?: Map<string, Run> }).__stackwiseRuns ??= new Map());

const info = (run: Run): RunInfo => ({ id: run.id, folder: run.folder, command: run.command, startedAt: run.startedAt, running: run.running, exitCode: run.exitCode, lines: run.lines });

/** A clean environment: never StackWise's own, which holds its AI keys. The project's scripts load their own env files. */
function childEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "TMPDIR", "JAVA_HOME"];
  return Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]])) as NodeJS.ProcessEnv;
}

export function startRun(folder: string, command: string): RunInfo {
  const existing = [...runs.values()].find((r) => r.folder === folder && r.command === command && r.running);
  if (existing) return info(existing);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error("That folder doesn't exist.");
  const child = spawn(command, { cwd: folder, shell: "/bin/sh", detached: true, env: childEnv() });
  const run: Run = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, folder, command, startedAt: new Date().toISOString(), running: true, exitCode: null, lines: 0, child, log: [] };
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      run.log.push(line);
      run.lines++;
    }
    if (run.log.length > LOG_LIMIT) run.log.splice(0, run.log.length - LOG_LIMIT);
  };
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  child.on("error", (error) => {
    run.running = false;
    run.log.push(`(couldn't start: ${error.message})`);
  });
  child.on("exit", (code) => {
    run.running = false;
    run.exitCode = code;
    run.log.push(`(stopped${code === null ? "" : `, exit code ${code}`})`);
  });
  runs.set(run.id, run);
  return info(run);
}

export function stopRun(id: string): RunInfo | null {
  const run = runs.get(id);
  if (!run) return null;
  if (run.running && run.child.pid) {
    try {
      // The whole group, so a script's children (Maven, then Java) stop too.
      process.kill(-run.child.pid, "SIGTERM");
    } catch {
      run.child.kill("SIGTERM");
    }
  }
  return info(run);
}

export function listRuns(folder: string): RunInfo[] {
  return [...runs.values()].filter((r) => r.folder === folder).map(info);
}

/** Log lines after a count, so the page only asks for what's new. */
export function runLog(id: string, after: number): { lines: string[]; total: number } | null {
  const run = runs.get(id);
  if (!run) return null;
  const firstKept = run.lines - run.log.length;
  return { lines: run.log.slice(Math.max(0, after - firstKept)), total: run.lines };
}
