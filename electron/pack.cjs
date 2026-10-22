// After `next build` with STACKWISE_STANDALONE=1: the standalone server needs the static files,
// public/ and data/ beside it, which Next leaves out. Copied here, then electron-builder ships the
// folder as the app's resources.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const built = path.join(root, ".next", "standalone");
const out = path.join(root, ".next", "app-standalone");
if (!fs.existsSync(path.join(built, "server.js"))) {
  console.error("No .next/standalone/server.js: run STACKWISE_STANDALONE=1 next build first.");
  process.exit(1);
}
// pnpm lays node_modules out as symlinks into a store; copied as files, the folder works on any Mac.
// Node's cpSync keeps symlinked folders as links even with dereference, so cp -RL does the copy.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execFileSync("cp", ["-RL", `${built}/.`, out]);
for (const [from, to] of [
  [".next/static", ".next/static"],
  ["public", "public"],
  ["data", "data"],
]) {
  fs.rmSync(path.join(out, to), { recursive: true, force: true });
  fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true, dereference: true });
}
// Nothing of the person's goes into the bundle: no keys, no state.
for (const stray of [".env.local", ".env", ".stackwise"]) fs.rmSync(path.join(out, stray), { recursive: true, force: true });
const links = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) links.push(path.join(dir, entry.name));
    else if (entry.isDirectory()) walk(path.join(dir, entry.name));
  }
};
walk(out);
if (links.length) {
  console.error(`Symlinks left in ${out}: ${links.slice(0, 5).join(", ")}`);
  process.exit(1);
}
console.log(`Packed ${out}: server.js, .next/static, public, data, no symlinks.`);
