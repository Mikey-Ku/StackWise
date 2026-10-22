import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PLAN_FILE } from "@/engine/names";
import { sharedPlanSchema } from "@/engine/share";
import { readLibraryIndex, readProfile, stackwiseHome, writeLibraryIndex } from "@/local/home";
import { localOnly, readJson } from "@/mcp/local";
import { homeRegistry, PLAN_ID, projectPlanFileSchema, toProjectPlanFile } from "@/mcp/registry";
import { resolveRealFolder } from "@/mcp/writeproject";

/**
 * The library: every plan on this computer, in ~/.stackwise/plans (src/local/home.ts). GET hands
 * the app all of them with which is open; PUT saves what the app has, plan by plan, never over a
 * newer change an agent made; DELETE removes one. A plan linked to a project folder is also
 * written there as stackwise.plan.json, so the record travels with the code.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Plans carry icons and conversations, so the body can be bigger than the usual cap. */
const LIBRARY_BODY_BYTES = 24 * 1024 * 1024;

const spot = z.object({ x: z.number(), y: z.number() });
const localSchema = z.object({
  step: z.enum(["describe", "confirm", "plan"]),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  layout: z.record(z.string().max(80), spot).default({}),
  checked: z.record(z.string().max(120), z.boolean()).default({}),
  guesses: z.record(z.string().max(40), z.object({ answer: z.enum(["yes", "no", "not_sure"]), evidence: z.string().max(2000), by: z.enum(["ai", "keywords", "template"]) })).default({}),
  chat: z.array(z.record(z.string(), z.unknown())).max(80).default([]),
  icon: z.string().max(400_000).optional(),
  folder: z.string().max(1024).optional(),
});
const putSchema = z.object({
  activeId: z.string().regex(PLAN_ID),
  order: z.array(z.string().regex(PLAN_ID)).max(500),
  plans: z.array(z.object({ id: z.string().regex(PLAN_ID), plan: sharedPlanSchema, local: localSchema })).max(500),
});
const deleteSchema = z.object({ id: z.string().regex(PLAN_ID) });

export function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const root = process.cwd();
  const registry = homeRegistry(root);
  const dir = stackwiseHome();
  const index = readLibraryIndex(dir);
  const plans = registry.list().map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedBy, plan: r.plan, local: r.local ?? null }));
  return Response.json({ activeId: index.activeId, order: index.order, plans, profile: readProfile(dir), dir });
}

export async function PUT(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = putSchema.safeParse(await readJson(request, LIBRARY_BODY_BYTES));
  if (!parsed.success) return Response.json({ error: "That isn't a library StackWise understands." }, { status: 400 });
  const root = process.cwd();
  const registry = homeRegistry(root);
  const saved: string[] = [];
  const kept: string[] = [];
  for (const item of parsed.data.plans) {
    const current = registry.read(item.id);
    const same = current && JSON.stringify(current.plan) === JSON.stringify(item.plan);
    // An agent changed the plan after the app last touched it: the app takes that change first (usePairing), not the other way round.
    const agentNewer = current && current.updatedBy === "claude" && Date.parse(current.updatedAt) > Date.parse(item.local.updatedAt);
    if (!same && agentNewer) kept.push(item.id);
    const record = !same && !agentNewer ? registry.savePlan(item.id, item.plan, "browser") : current!;
    const withLocal = JSON.stringify(record.local) === JSON.stringify(item.local) ? record : registry.setLocal(item.id, item.local);
    if (!same && !agentNewer) saved.push(item.id);
    if (withLocal && item.local.folder) writePlanFile(withLocal, item.local.folder, root);
  }
  writeLibraryIndex(stackwiseHome(), { activeId: parsed.data.activeId, order: parsed.data.order });
  return Response.json({ saved, kept });
}

export async function DELETE(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = deleteSchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "Say which plan." }, { status: 400 });
  const dir = stackwiseHome();
  const removed = homeRegistry(process.cwd()).remove(parsed.data.id);
  const index = readLibraryIndex(dir);
  writeLibraryIndex(dir, { activeId: index.activeId === parsed.data.id ? null : index.activeId, order: index.order.filter((id) => id !== parsed.data.id) });
  return Response.json({ removed });
}

/** The plan into its project folder, unless the folder's copy is newer (an agent wrote it and the app hasn't caught up). */
function writePlanFile(record: { id: string; version: number; updatedAt: string; plan: z.infer<typeof sharedPlanSchema> }, folder: string, root: string) {
  const resolved = resolveRealFolder(folder, root);
  if ("error" in resolved) return;
  const file = path.join(resolved.path, PLAN_FILE);
  try {
    if (!fs.existsSync(resolved.path) || !fs.statSync(resolved.path).isDirectory()) return;
    if (fs.existsSync(file)) {
      const existing = projectPlanFileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
      if (existing.success && (existing.data.version > record.version || JSON.stringify(existing.data.plan) === JSON.stringify(record.plan))) return;
      if (fs.lstatSync(file).isSymbolicLink()) return;
    }
    fs.writeFileSync(file, `${JSON.stringify(toProjectPlanFile(record), null, 2)}\n`);
  } catch {
    // The project folder is the person's; a file that can't be written is left alone.
  }
}
