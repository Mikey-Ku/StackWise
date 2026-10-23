// Runs in the page before StackWise loads, with no access to Node beyond Electron's own bridge.
// It marks the page as being inside the Mac app, so the top bars leave room for the window's
// traffic lights and can be dragged (globals.css and shell.css read data-desktop), and relays
// whether the window is in full screen, where macOS hides the traffic lights and that room goes.
const { ipcRenderer } = require("electron");

document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktop = "mac";
});
ipcRenderer.on("fullscreen", (_event, on) => {
  document.documentElement?.toggleAttribute("data-fullscreen", Boolean(on));
});
