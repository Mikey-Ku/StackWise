import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * `stackwise`, run in any project folder:
 *
 *   stackwise            open StackWise on this folder's plan (starting StackWise if it isn't running)
 *   stackwise ~/code/x   the same, for another folder
 *   stackwise setup      connect Claude Code to StackWise once, so /mcp__stackwise__pair works everywhere
 *   stackwise stop       stop the StackWise this command started
 *
 * StackWise itself runs from its own folder (this repo) on http://localhost:4310, in the background,
 * with its log in .stackwise/server.log. Opening a folder sends the browser to #open=<folder>, and
 * the page picks the folder's stackwise.plan.json, a plan already linked to it, or a new one.
 */

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const URL_BASE = "http://localhost:4310";
const STATE = path.join(ROOT, ".stackwise");
// Carry the log and pid over from when StackWise was called WhyStack.
if (!fs.existsSync(STATE) && fs.existsSync(path.join(ROOT, ".whystack"))) fs.renameSync(path.join(ROOT, ".whystack"), STATE);
const PID_FILE = path.join(STATE, "server.pid");
const LOG_FILE = path.join(STATE, "server.log");

const say = (line = "") => process.stdout.write(`${line}\n`);

async function running(): Promise<boolean> {
  try {
    const response = await fetch(`${URL_BASE}/api/status`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<void> {
  if (await running()) return;
  fs.mkdirSync(STATE, { recursive: true });
  const log = fs.openSync(LOG_FILE, "a");
  say("Starting StackWise in the background...");
  const child = spawn("pnpm", ["dev"], { cwd: ROOT, detached: true, stdio: ["ignore", log, log] });
  fs.writeFileSync(PID_FILE, String(child.pid));
  child.unref();
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await running()) return;
  }
  throw new Error(`StackWise didn't start within a minute. Its log is at ${LOG_FILE}.`);
}

function openBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawnSync(opener, [url], { stdio: "ignore", shell: process.platform === "win32" });
}

function claudeHas(name: string): boolean {
  const result = spawnSync("claude", ["mcp", "get", name], { encoding: "utf8", timeout: 30_000 });
  return result.status === 0;
}

async function open(folderArg: string | undefined) {
  const folder = path.resolve(folderArg ?? process.cwd());
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`${folder} isn't a folder.`);
  await ensureServer();
  const url = `${URL_BASE}/#open=${encodeURIComponent(folder)}`;
  openBrowser(url);
  say(`StackWise is open on ${folder}`);
  say(`  ${URL_BASE}`);
  say();
  say("To work with Claude Code on this plan, in this folder:");
  say("  claude");
  say("  /mcp__stackwise__pair");
  say("Then write to it from Ask in StackWise. (First time? Run: stackwise setup)");
}

function setup() {
  if (spawnSync("claude", ["--version"], { stdio: "ignore" }).status !== 0) {
    say("Claude Code isn't installed. Get it at https://claude.com/claude-code, then run stackwise setup again.");
    return;
  }
  // Set up before the rename, under StackWise's old name: replace it.
  if (claudeHas("whystack")) spawnSync("claude", ["mcp", "remove", "--scope", "user", "whystack"], { stdio: "ignore" });
  if (claudeHas("stackwise")) {
    say("Claude Code already knows StackWise. In any project: claude, then /mcp__stackwise__pair");
    return;
  }
  const added = spawnSync("claude", ["mcp", "add", "--transport", "http", "--scope", "user", "stackwise", `${URL_BASE}/api/mcp`], { stdio: "inherit" });
  if (added.status === 0) say("Done. In any project: claude, then /mcp__stackwise__pair");
  else say("That didn't work. You can add it yourself: claude mcp add --transport http --scope user stackwise http://localhost:4310/api/mcp");
}

function stop() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8"));
    process.kill(-pid, "SIGTERM");
    fs.rmSync(PID_FILE, { force: true });
    say("Stopped StackWise.");
  } catch {
    say("No StackWise started by this command is running. If you started it with pnpm dev, stop it there.");
  }
}

async function main() {
  const [command, arg] = process.argv.slice(2).filter((a) => a !== "--");
  if (command === "setup") return setup();
  if (command === "stop") return stop();
  if (command === "help" || command === "--help" || command === "-h") {
    say("stackwise [folder]   open StackWise on a project (the current folder by default)");
    say("stackwise setup      connect Claude Code to StackWise once");
    say("stackwise stop       stop the StackWise this command started");
    return;
  }
  await open(command ?? arg);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
