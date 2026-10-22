// After `next build` with STACKWISE_STANDALONE=1: the standalone server needs the static files,
// public/ and data/ beside it, which Next leaves out. Copied here, then after-pack.cjs ships the
// folder inside the app bundle.
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
// pnpm lays node_modules out as symlinks into a store (.pnpm), and Node resolves a package's
// dependencies from where the link points, so the links have to stay links: copied as plain
// folders, next can't find @swc/helpers any more. cp -R keeps them; the loop below makes every
// absolute one relative, so the folder works wherever the bundle ends up.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execFileSync("cp", ["-R", `${built}/.`, out]);
for (const [from, to] of [
  [".next/static", ".next/static"],
  ["public", "public"],
  ["data", "data"],
]) {
  fs.rmSync(path.join(out, to), { recursive: true, force: true });
  fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true, dereference: true });
}
// The Documentation page reads the repo's Markdown, so it comes along (the text, not the images).
fs.mkdirSync(path.join(out, "docs"), { recursive: true });
fs.copyFileSync(path.join(root, "README.md"), path.join(out, "README.md"));
for (const name of fs.readdirSync(path.join(root, "docs")).filter((f) => f.endsWith(".md"))) fs.copyFileSync(path.join(root, "docs", name), path.join(out, "docs", name));
// Nothing of the person's goes into the bundle: no keys, no state.
for (const stray of [".env.local", ".env", ".stackwise"]) fs.rmSync(path.join(out, stray), { recursive: true, force: true });

let relinked = 0;
const bad = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      let target = fs.readlinkSync(file);
      if (path.isAbsolute(target)) {
        const inside = path.relative(built, target);
        if (inside.startsWith("..")) {
          bad.push(`${file} -> ${target}`);
          continue;
        }
        target = path.relative(path.dirname(file), path.join(out, inside));
        fs.unlinkSync(file);
        fs.symlinkSync(target, file);
        relinked += 1;
      }
      let real;
      try {
        real = fs.realpathSync(file);
      } catch {
        bad.push(`${file} -> ${target} (dangling)`);
        continue;
      }
      if (path.relative(out, real).startsWith("..")) bad.push(`${file} -> ${real} (outside)`);
    } else if (entry.isDirectory()) walk(file);
  }
};
walk(out);
if (bad.length) {
  console.error(`Links that leave ${out}:\n${bad.slice(0, 8).join("\n")}`);
  process.exit(1);
}
console.log(`Packed ${out}: server.js, .next/static, public, data; ${relinked} links made relative, none leave the folder.`);
