// StackWise as a Mac app. It runs StackWise's server on this computer (127.0.0.1:4310, the same
// address the stackwise command and Claude Code use), shows it in a window, and stays in the menu
// bar when the window is closed so coding agents can still reach the MCP server. Quit stops the
// server. Only Electron's own modules are used here, so the app bundle carries no other code.
const { app, BrowserWindow, Menu, Tray, clipboard, nativeImage, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 4310;
const URL = `http://${HOST}:${PORT}`;
const MCP_URL = `${URL}/api/mcp`;
const HOME = process.env.STACKWISE_HOME || path.join(os.homedir(), ".stackwise");

/** @type {import("node:child_process").ChildProcess | null} */
let server = null;
/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;

async function up() {
  try {
    const response = await fetch(`${URL}/api/status`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** AI keys saved from the app live in ~/.stackwise/.env.local; the server gets them at start. */
function savedEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(HOME, ".env.local"), "utf8").split("\n")) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !match[1].startsWith("#")) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {
    // No keys yet.
  }
  return env;
}

function startServer() {
  fs.mkdirSync(HOME, { recursive: true });
  const log = fs.openSync(path.join(HOME, "app.log"), "a");
  const env = { ...process.env, ...savedEnv(), PORT: String(PORT), HOSTNAME: HOST, STACKWISE_HOME: HOME, STACKWISE_DESKTOP: "1" };
  if (app.isPackaged) {
    // The built site, with data/ and public/ beside server.js, run by the Node inside Electron.
    const dir = path.join(process.resourcesPath, "standalone");
    server = spawn(process.execPath, [path.join(dir, "server.js")], { cwd: dir, env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", log, log] });
  } else {
    // Development: the repo's dev server, with hot reload.
    server = spawn("pnpm", ["dev"], { cwd: path.join(__dirname, ".."), env, stdio: ["ignore", log, log], shell: true });
  }
  server.on("exit", () => {
    server = null;
  });
}

async function waitForServer() {
  for (let i = 0; i < 240; i++) {
    if (await up()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 880,
    minHeight: 600,
    title: "StackWise",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: "#f5f5f7",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  // The window is visible from the start. Created hidden and shown on ready-to-show, its page
  // stayed in the hidden state on macOS 26: no layout, no paint, a blank gray window.
  // Links to other sites open in the browser, never in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  // Closing the window keeps StackWise running for agents; Quit stops it.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win && win.hide();
  });
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(SPLASH);
  // A load that fails because the server is still starting is tried again, up to ten times.
  let retries = 0;
  win.webContents.on("did-fail-load", (event, code, description, url, isMainFrame) => {
    if (!isMainFrame || !url.startsWith(URL) || retries >= 10) return;
    retries += 1;
    setTimeout(() => win && win.loadURL(url), 500);
  });
}

const MARK = `<svg width="72" height="72" viewBox="0 0 1254 1254" aria-hidden="true"><rect width="1254" height="1254" rx="270" fill="#0561ee"/><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="M627 337 L933 520 L627 703 L322 520 Z" stroke-width="62"/><path d="M322 668 L627 848 L932 668" stroke-width="64"/><path d="M322 792 L627 967 L932 792" stroke-width="64"/><circle cx="607" cy="517" r="88" stroke-width="34"/><path d="M562 520 a46 46 0 0 1 40 -40" stroke-width="20"/><path d="M692 570 L735 604" stroke="#0561ee" stroke-width="92"/><path d="M692 570 L735 604" stroke-width="46"/></g></svg>`;
const PAGE_STYLE = `html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#f5f5f7;color:#6e6e73;font:15px -apple-system,system-ui,sans-serif;-webkit-app-region:drag;-webkit-user-select:none}@media(prefers-color-scheme:dark){body{background:#1c1c1e;color:#98989d}}.m{display:grid;gap:16px;justify-items:center;text-align:center}.m strong{color:#1d1d1f;font-size:17px}@media(prefers-color-scheme:dark){.m strong{color:#f5f5f7}}@keyframes p{50%{opacity:.45}}.t{animation:p 1.6s ease-in-out infinite}code{font:13px ui-monospace,Menlo,monospace}`;
/** A page of the app's own, shown while the server starts and if it doesn't. */
const localPage = (body) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>${PAGE_STYLE}</style><body><div class="m">${MARK}${body}</div></body>`)}`;
const SPLASH = localPage(`<div class="t">Starting StackWise</div>`);

/** The page the app opens on: your projects; the canvas is one click from there. */
function loadHome() {
  win && win.loadURL(`${URL}/projects`);
}

function showWindow() {
  if (!win) {
    createWindow();
    loadHome();
  } else {
    win.show();
    win.focus();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("StackWise");
  const refresh = async () => {
    const running = await up();
    tray &&
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Open StackWise", click: showWindow },
          { type: "separator" },
          { label: running ? `MCP server: running at ${HOST}:${PORT}` : "MCP server: starting", enabled: false },
          { label: "Copy the MCP address", click: () => clipboard.writeText(MCP_URL) },
          { label: "Open the data folder", click: () => shell.openPath(HOME) },
          { type: "separator" },
          { label: "Quit StackWise", click: () => app.quit() },
        ]),
      );
  };
  tray.on("click", showWindow);
  void refresh();
  setInterval(() => void refresh(), 15_000);
}

function appMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "StackWise", submenu: [{ role: "about" }, { type: "separator" }, { label: "Settings", accelerator: "Cmd+,", click: () => (showWindow(), win && win.loadURL(`${URL}/settings`)) }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { role: "quit" }] },
      { label: "File", submenu: [{ label: "Projects", accelerator: "Cmd+O", click: () => (showWindow(), win && win.loadURL(`${URL}/projects`)) }, { label: "The canvas", accelerator: "Cmd+1", click: () => (showWindow(), win && win.loadURL(URL)) }, { type: "separator" }, { role: "close" }] },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      { label: "Help", submenu: [{ label: "Documentation", click: () => (showWindow(), win && win.loadURL(`${URL}/docs`)) }, { label: "StackWise on GitHub", click: () => shell.openExternal("https://github.com/Mikey-Ku/StackWise") }] },
    ]),
  );
}

// One copy at a time: a second launch opens the window of the first.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  appMenu();
  // A StackWise already running (the stackwise command, or pnpm dev) is used as it is.
  if (!(await up())) startServer();
  createTray();
  // The window comes up at once (gray), and loads the page only when the server answers: a load
  // sent before that failed with ECONNREFUSED and left the window blank for good.
  createWindow();
  if (await waitForServer()) loadHome();
  else {
    win && win.loadURL(localPage(`<strong>StackWise didn't start</strong><div>Its log is in <code>${HOME}/app.log</code>.</div>`));
  }
});

app.on("activate", showWindow);
app.on("before-quit", () => {
  quitting = true;
  if (server && server.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
});
// The app lives in the menu bar; closing every window doesn't quit it.
app.on("window-all-closed", () => undefined);
