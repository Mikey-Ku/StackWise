import { z } from "zod";
import { buildProjectPack, envFileText, planEnv, planInput, recommend, type SpecFile } from "@/engine";
import { indexCatalog } from "@/engine/evaluate";
import { loadCatalog } from "@/engine/load";
import { sharedPlanSchema } from "@/engine/share";
import { localOnly } from "@/mcp/local";
import { NEVER_REPLACE } from "@/mcp/localfiles";
import { writeProjectFolder } from "@/mcp/writeproject";
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

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { path, id, plan, generatedOn }." }, { status: 400 });
  const { plan, generatedOn, dryRun, replace } = parsed.data;

  const root = process.cwd();

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
    { name: NEVER_REPLACE, content: envFileText(env, { appName: plan.appName, generatedOn, custom: plan.custom }) },
  ];

  const result = writeProjectFolder(parsed.data.path, files, { whystackRoot: root, envNames: env.map((v) => v.name), replace, dryRun });
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ...result, command: `cd ${result.path.includes(" ") ? `"${result.path}"` : result.path}` });
}
