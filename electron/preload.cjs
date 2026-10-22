// Runs in the page before StackWise loads, with no access to Node. It marks the page as being
// inside the Mac app, so the top bars leave room for the window's traffic lights and can be
// dragged (globals.css and shell.css read data-desktop).
document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktop = "mac";
});
