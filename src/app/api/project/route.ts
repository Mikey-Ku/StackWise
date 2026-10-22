import fs from "node:fs";
import os from "node:os";
import { z } from "zod";
import { localOnly, readJson } from "@/mcp/local";
import { resolveRealFolder } from "@/mcp/writeproject";
import { projectPlanFileSchema } from "@/mcp/registry";
import { ENV_NAME } from "@/project/envfile";
import { iconData, inspect, writeEnv } from "@/project/local";
import { LEGACY_PLAN_FILE, PLAN_FILE } from "@/engine/names";

/**
 * A plan's linked project folder: what's in it, which env variable names it has, its icon and its
 * plan file. Only this computer can call it, only for folders inside the home folder, and no env
 * value ever comes back in a response. The one write is a variable into the project's .env.local.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const path = z.string().min(1).max(1024);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), path }),
  z.object({ action: z.literal("env"), path, name: z.string().regex(ENV_NAME).max(120), value: z.string().max(8000) }),
  z.object({ action: z.literal("icon"), path }),
  z.object({ action: z.literal("planfile"), path }),
]);

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "That request wasn't one StackWise understands." }, { status: 400 });
  const body = parsed.data;
  const folder = resolveRealFolder(body.path, process.cwd());
  if ("error" in folder) return Response.json({ error: folder.error }, { status: 400 });
  const dir = folder.path;

  switch (body.action) {
    case "inspect":
      return Response.json({ ...inspect(dir), home: os.homedir() });
    case "env": {
      if (!inspect(dir).exists) return Response.json({ error: "That folder doesn't exist." }, { status: 404 });
      try {
        const result = writeEnv(dir, body.name, body.value);
        return Response.json({ ok: true, ...result, project: inspect(dir) });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Couldn't write .env.local." }, { status: 400 });
      }
    }
    case "icon": {
      const file = inspect(dir).icon;
      const data = file ? iconData(dir, file) : null;
      return data ? Response.json({ file, data }) : Response.json({ error: "StackWise didn't find an icon in this project." }, { status: 404 });
    }
    case "planfile": {
      // The project's own plan, when it has one, so opening the folder opens its plan.
      try {
        const name = [PLAN_FILE, LEGACY_PLAN_FILE].find((candidate) => fs.existsSync(`${dir}/${candidate}`)) ?? PLAN_FILE;
        const file = projectPlanFileSchema.parse(JSON.parse(fs.readFileSync(`${dir}/${name}`, "utf8")));
        return Response.json({ id: file.id, plan: file.plan });
      } catch {
        return Response.json({ error: "This project has no stackwise.plan.json." }, { status: 404 });
      }
    }
  }
}
