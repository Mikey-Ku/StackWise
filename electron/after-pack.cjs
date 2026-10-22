// electron-builder hook: puts the standalone server into the app bundle. electron-builder's own
// extraResources copy leaves out node_modules, which the server needs, so this copies the folder
// pack.cjs made (symlinks kept, all relative) into Contents/Resources/standalone before the
// bundle is signed.
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  const from = path.join(__dirname, "..", ".next", "app-standalone");
  if (!fs.existsSync(path.join(from, "server.js"))) throw new Error("No .next/app-standalone/server.js: run node electron/pack.cjs first.");
  const app = `${context.packager.appInfo.productFilename}.app`;
  const to = path.join(context.appOutDir, app, "Contents", "Resources", "standalone");
  fs.rmSync(to, { recursive: true, force: true });
  execFileSync("cp", ["-R", from, to]);
  const next = path.join(to, "node_modules", "next", "package.json");
  if (!fs.existsSync(next) || path.relative(to, fs.realpathSync(next)).startsWith("..")) throw new Error(`The copied standalone's node_modules/next doesn't resolve inside ${to}`);
  console.log(`  • standalone server copied into ${app}/Contents/Resources/standalone`);
};
