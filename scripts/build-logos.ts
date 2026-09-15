import fs from "node:fs";
import path from "node:path";
import type { Logo } from "@/engine/schema";
import { args } from "./lib";
import { LOGOS_DIR, buildLogo, readManifest, writeManifest } from "./logos";

/**
 * pnpm build:logos [-- --only polar,github-pages]
 *
 * Writes a logo for every option in data/logos.json into public/logos (scripts/logos.ts says where
 * they come from) and records each file and its source in the manifest. The files are committed,
 * so the app never fetches a logo at runtime. A logo that fails to download keeps the file already
 * on disk.
 */

async function main() {
  const entries = readManifest();
  const flags = args();
  const only = typeof flags.only === "string" ? flags.only.split(",") : null;
  fs.mkdirSync(LOGOS_DIR, { recursive: true });

  const manifest: Record<string, Logo> = {};
  const failures: string[] = [];
  for (const [id, entry] of Object.entries(entries)) {
    manifest[id] = entry;
    if (only && !only.includes(id)) continue;
    try {
      const built = await buildLogo(id, entry);
      if (entry.file && entry.file !== built.file) fs.rmSync(path.join(LOGOS_DIR, entry.file), { force: true });
      manifest[id] = built;
      console.log(`${id}: ${built.file} (${built.source})`);
    } catch (error) {
      const kept = entry.file !== undefined && fs.existsSync(path.join(LOGOS_DIR, entry.file));
      failures.push(`${(error as Error).message}${kept ? " (kept the existing file)" : ""}`);
    }
  }
  writeManifest(manifest);

  // Files no entry points to anymore: a service that was removed, or an icon that changed type.
  const referenced = new Set(Object.values(manifest).map((entry) => entry.file));
  for (const file of fs.readdirSync(LOGOS_DIR)) {
    if (!referenced.has(file)) fs.rmSync(path.join(LOGOS_DIR, file));
  }

  if (failures.length) {
    console.error(`\n${failures.length} logo${failures.length === 1 ? "" : "s"} failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  const count = Object.values(manifest).filter((entry) => entry.file).length;
  console.log(`\n${only ? `Rebuilt ${only.join(", ")}. ` : ""}${count} logos in public/logos.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
