import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readProfile, stackwiseHome } from "@/local/home";
import { scanFolder, type ScanFs } from "@/local/scan";
import { localOnly } from "@/mcp/local";
import { expandHome } from "@/mcp/localfiles";
import { homeRegistry } from "@/mcp/registry";
import { resolveRealFolder } from "@/mcp/writeproject";

/**
 * The projects on this computer: every folder one level under the folders in your profile that
 * has a plan file or looks like an app. Read-only, this computer only, inside your home folder.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const realFs: ScanFs = {
  folders(dir) {
    try {
      return fs.readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  },
  exists: (file) => fs.existsSync(/* turbopackIgnore: true */ file),
  read(file) {
    try {
      return fs.readFileSync(/* turbopackIgnore: true */ file, "utf8");
    } catch {
      return null;
    }
  },
};

export function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const root = process.cwd();
  const known = new Set(homeRegistry(root).list().map((r) => r.id));
  const folders = readProfile(stackwiseHome()).folders.map((folder) => {
    const resolved = resolveRealFolder(folder, root);
    if ("error" in resolved) return { path: folder, error: resolved.error, projects: [] };
    if (!fs.existsSync(resolved.path)) return { path: folder, error: "That folder doesn't exist.", projects: [] };
    const projects = scanFolder(realFs, resolved.path).map((p) => ({ ...p, path: p.path, short: p.path.replace(`${os.homedir()}${path.sep}`, "~/"), inLibrary: p.plan ? known.has(p.plan.id) : false }));
    return { path: folder, resolved: expandHome(folder, os.homedir()), projects };
  });
  return Response.json({ folders, home: os.homedir() });
}
