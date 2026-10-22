// Runs electron-builder for the Mac app from inside electron/, so its package.json (no
// dependencies) is the project and only the four app files go into app.asar. Run under
// `pnpm app:build`, electron-builder sees pnpm in npm_config_user_agent and asks pnpm for the
// dependency tree, which answers with the repo's: 300 MB of node_modules in the bundle. Without
// those variables it falls back to the folder itself and packs nothing extra.
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("npm_") && !name.startsWith("PNPM_")));
const args = process.argv.slice(2);
const result = spawnSync(path.join(root, "node_modules", ".bin", "electron-builder"), ["--mac", "--arm64", "--publish", "never", ...args], { cwd: __dirname, env, stdio: "inherit" });
process.exit(result.status ?? 1);
