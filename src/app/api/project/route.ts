import fs from "node:fs";
import os from "node:os";
import { z } from "zod";
import { localOnly } from "@/mcp/local";
import { resolveFolder } from "@/mcp/localfiles";
import { projectPlanFileSchema } from "@/mcp/registry";
import { ENV_NAME } from "@/project/envfile";
import { iconData, inspect, listRuns, probe, runLog, runSql, startRun, stopRun, writeEnv } from "@/project/local";
import { addWorktree, changes, mergeBranch, removeWorktree, repoInfo } from "@/project/git";
import { PROBES } from "@/project/probes";

/**
 * A plan's linked project folder: what's in it, its env variables, live checks, the read-only SQL
 * console, and the processes StackWise runs for it. Only this computer can call it, only for
 * folders inside the home folder, and no env value ever comes back in a response.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const path = z.string().min(1).max(1024);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), path }),
  z.object({ action: z.literal("env"), path, name: z.string().regex(ENV_NAME).max(120), value: z.string().max(8000) }),
  z.object({ action: z.literal("probe"), path, ids: z.array(z.string().max(80)).min(1).max(20), healthUrl: z.string().url().optional() }),
  z.object({ action: z.literal("sql"), path, query: z.string().max(10_000) }),
  z.object({ action: z.literal("start"), path, command: z.string().min(1).max(500) }),
  z.object({ action: z.literal("stop"), path, id: z.string().max(40) }),
  z.object({ action: z.literal("runs"), path, logFor: z.string().max(40).optional(), after: z.number().int().min(0).default(0) }),
  z.object({ action: z.literal("icon"), path }),
  z.object({ action: z.literal("git"), path }),
  z.object({ action: z.literal("planfile"), path }),
  z.object({ action: z.literal("worktree-add"), path, agent: z.string().max(40) }),
  z.object({ action: z.literal("merge"), path, branch: z.string().max(80) }),
  z.object({ action: z.literal("worktree-remove"), path, worktree: z.string().max(1024) }),
]);

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That request wasn't one StackWise understands." }, { status: 400 });
  const body = parsed.data;
  const folder = resolveFolder(body.path, os.homedir(), process.cwd());
  if ("error" in folder) return Response.json({ error: folder.error }, { status: 400 });
  const dir = folder.path;

  switch (body.action) {
    case "inspect":
      return Response.json({ ...inspect(dir), probes: Object.keys(PROBES), home: os.homedir() });
    case "env": {
      if (!inspect(dir).exists) return Response.json({ error: "That folder doesn't exist." }, { status: 404 });
      const result = writeEnv(dir, body.name, body.value);
      return Response.json({ ok: true, ...result, project: { ...inspect(dir), probes: Object.keys(PROBES) } });
    }
    case "probe": {
      const results = await Promise.all(body.ids.map((id) => probe(dir, id, body.healthUrl)));
      return Response.json({ results });
    }
    case "sql":
      return Response.json(await runSql(dir, body.query));
    case "start":
      return Response.json({ run: startRun(dir, body.command) });
    case "stop":
      return Response.json({ run: stopRun(body.id) });
    case "icon": {
      const file = inspect(dir).icon;
      const data = file ? iconData(dir, file) : null;
      return data ? Response.json({ file, data }) : Response.json({ error: "StackWise didn't find an icon in this project." }, { status: 404 });
    }
    case "planfile": {
      // The project's own plan, when it has one, so opening the folder opens its plan.
      try {
        const file = projectPlanFileSchema.parse(JSON.parse(fs.readFileSync(`${dir}/whystack.plan.json`, "utf8")));
        return Response.json({ id: file.id, plan: file.plan });
      } catch {
        return Response.json({ error: "This project has no whystack.plan.json." }, { status: 404 });
      }
    }
    case "git": {
      const info = await repoInfo(dir);
      const base = info.branch ?? "HEAD";
      const worktrees = await Promise.all(info.worktrees.map(async (w) => ({ ...w, changes: w.main ? null : await changes(w.path, base) })));
      return Response.json({ ...info, worktrees });
    }
    case "worktree-add":
      return Response.json(await addWorktree(dir, body.agent));
    case "merge":
      return Response.json(await mergeBranch(dir, body.branch));
    case "worktree-remove": {
      // Only an agent's copy that git itself lists for this project, never the main one.
      const listed = (await repoInfo(dir)).worktrees.find((w) => w.path === body.worktree && !w.main && w.agent);
      if (!listed) return Response.json({ error: "That isn't one of this project's agent copies." }, { status: 400 });
      return Response.json(await removeWorktree(dir, listed.path));
    }
    case "runs":
      return Response.json({ runs: listRuns(dir), log: body.logFor ? runLog(body.logFor, body.after) : null });
  }
}
