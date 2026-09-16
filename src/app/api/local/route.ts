import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { buildProjectPack, envFileText, planEnv, planInput, recommend, type SpecFile } from "@/engine";
import { indexCatalog } from "@/engine/evaluate";
import { loadCatalog } from "@/engine/load";
import { sharedPlanSchema } from "@/engine/share";
import { localOnly } from "@/mcp/local";
import { missingEnvNames, NEVER_REPLACE, planWrites, resolveFolder } from "@/mcp/localfiles";
import { PLAN_ID } from "@/mcp/registry";

/**
 * Writing the project into a folder on this computer, instead of downloading a zip. Same files,
 * plus a `.env.local` with the names it needs and no values. Only answers this computer, only
 * writes inside the home folder, and never writes over an existing `.env.local`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  path: z.string().max(1024),
  id: z.string().regex(PLAN_ID),
  plan: sharedPlanSchema,
  generatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** true: say what would happen, write nothing. */
  dryRun: z.boolean().default(false),
  replace: z.boolean().default(false),
});

function readIfThere(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { path, id, plan, generatedOn }." }, { status: 400 });
  const { plan, generatedOn, dryRun, replace } = parsed.data;

  const root = process.cwd();
  const folder = resolveFolder(parsed.data.path, os.homedir(), root);
  if ("error" in folder) return Response.json({ error: folder.error }, { status: 400 });

  const index = indexCatalog(loadCatalog());
  const input = planInput(plan);
  const { selection } = recommend(index, input, plan.pinned);
  const env = planEnv(index, selection);
  const files: SpecFile[] = [
    ...buildProjectPack(
      index,
      input,
      selection,
      { appName: plan.appName, description: plan.description, features: plan.features, builderId: plan.builderId, generatedOn, planId: parsed.data.id, plan },
      { whystackRoot: root },
    ),
    { name: NEVER_REPLACE, content: envFileText(env, { appName: plan.appName, generatedOn }) },
  ];

  const exists = (name: string) => fs.existsSync(path.join(folder.path, name));
  const { write, keep } = planWrites(files, exists, replace);
  const missing = missingEnvNames(env.map((v) => v.name), readIfThere(path.join(folder.path, NEVER_REPLACE)));
  const report = {
    path: folder.path,
    folderExists: fs.existsSync(folder.path),
    write: write.map((f) => f.name),
    keep,
    missingEnv: missing,
    command: `cd ${folder.path.includes(" ") ? `"${folder.path}"` : folder.path}`,
  };
  if (dryRun) return Response.json({ ...report, wrote: [] });

  try {
    for (const file of write) {
      const target = path.join(folder.path, file.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content);
    }
  } catch (error) {
    return Response.json({ error: `Couldn't write there: ${(error as Error).message}` }, { status: 400 });
  }
  return Response.json({ ...report, folderExists: true, wrote: report.write });
}
