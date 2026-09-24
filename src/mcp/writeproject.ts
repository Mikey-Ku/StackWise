import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SpecFile } from "@/engine";
import { missingEnvNames, NEVER_REPLACE, planWrites, resolveFolder, type KeptFile } from "./localfiles";

/**
 * Node-only. Writing a project pack into a folder, for the Export dialog (/api/local) and for
 * agents (export_project), under the same rules in localfiles.ts: inside the home folder, never
 * StackWise's own folder, nothing replaced unless asked, and `.env.local` never replaced.
 */

export interface WriteReport {
  path: string;
  folderExists: boolean;
  write: string[];
  keep: KeptFile[];
  missingEnv: string[];
  wrote: string[];
}

export function writeProjectFolder(
  input: string,
  files: SpecFile[],
  options: { whystackRoot: string; envNames: string[]; replace?: boolean; dryRun?: boolean; home?: string },
): WriteReport | { error: string } {
  const folder = resolveFolder(input, options.home ?? os.homedir(), options.whystackRoot);
  if ("error" in folder) return folder;
  const exists = (name: string) => fs.existsSync(path.join(folder.path, name));
  const { write, keep } = planWrites(files, exists, options.replace ?? false);
  let envLocal: string | null = null;
  try {
    envLocal = fs.readFileSync(path.join(folder.path, NEVER_REPLACE), "utf8");
  } catch {
    // No .env.local yet: nothing can be missing from it.
  }
  const report = { path: folder.path, folderExists: fs.existsSync(folder.path), write: write.map((f) => f.name), keep, missingEnv: missingEnvNames(options.envNames, envLocal), wrote: [] as string[] };
  if (options.dryRun) return report;
  try {
    for (const file of write) {
      const target = path.join(folder.path, file.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, file.name === NEVER_REPLACE ? { mode: 0o600 } : undefined);
    }
  } catch (error) {
    return { error: `Couldn't write there: ${(error as Error).message}` };
  }
  return { ...report, folderExists: true, wrote: report.write };
}
