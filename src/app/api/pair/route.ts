import { z } from "zod";
import { sharedPlanSchema } from "@/engine/share";
import { localOnly } from "@/mcp/local";
import { SLOT_IDS } from "@/engine/schema";
import { AGENT_ID } from "@/mcp/pairing";
import { createRegistry, MESSAGE_MAX, PLAN_ID } from "@/mcp/registry";

/**
 * How the StackWise tab and coding agents share a plan. The tab puts the plan you have open (PUT),
 * asks for anything an agent changed, did or said since it last looked (GET), writes to an agent
 * (POST), and stops sharing (DELETE).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const putSchema = z.object({ id: z.string().regex(PLAN_ID), plan: sharedPlanSchema, baseVersion: z.number().int().min(0) });
const postSchema = z.object({
  id: z.string().regex(PLAN_ID),
  agent: z.string().regex(AGENT_ID),
  text: z.string().trim().min(1).max(MESSAGE_MAX),
  about: z.enum(SLOT_IDS).optional(),
  planVersion: z.number().int().min(0).optional(),
});

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

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { id, agent, text } for a shared plan." }, { status: 400 });
  const { id, ...message } = parsed.data;
  const saved = createRegistry(process.cwd()).postMessage(id, message);
  if (!saved) return Response.json({ error: "That plan isn't shared yet. Turn on sharing first." }, { status: 404 });
  return Response.json({ message: saved });
}

export function DELETE(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  createRegistry(process.cwd()).setActive(null);
  return Response.json({ ok: true });
}
