import { z } from "zod";
import { sharedPlanSchema } from "@/engine/share";
import { localOnly } from "@/mcp/local";
import { createRegistry, PLAN_ID } from "@/mcp/registry";

/**
 * How the WhyStack tab and Claude share a plan. The tab puts the plan you have open (PUT), asks
 * for anything Claude changed or did since it last looked (GET), and stops sharing (DELETE).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const putSchema = z.object({ id: z.string().regex(PLAN_ID), plan: sharedPlanSchema, baseVersion: z.number().int().min(0) });

export function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const registry = createRegistry(process.cwd());
  const since = new URL(request.url).searchParams.get("since");
  const after = since ? Date.parse(since) : 0;
  const records = registry.list().filter((r) => Date.parse(r.touchedAt) > (Number.isNaN(after) ? 0 : after));
  return Response.json({ now: new Date().toISOString(), active: registry.activeId(), records });
}

export async function PUT(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { id, plan, baseVersion } with a valid plan." }, { status: 400 });
  const { id, plan, baseVersion } = parsed.data;
  const registry = createRegistry(process.cwd());
  const current = registry.read(id);
  // Claude changed the plan after this tab last saw it: the tab takes Claude's version first.
  if (current && current.updatedBy === "claude" && current.version > baseVersion && JSON.stringify(current.plan) !== JSON.stringify(plan)) {
    registry.setActive(id);
    return Response.json({ conflict: true, record: current }, { status: 409 });
  }
  const record = registry.savePlan(id, plan, "browser");
  registry.setActive(id);
  return Response.json({ version: record.version, touchedAt: record.touchedAt });
}

export function DELETE(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  createRegistry(process.cwd()).setActive(null);
  return Response.json({ ok: true });
}
