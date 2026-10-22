import os from "node:os";
import { accountName, profileSchema, readProfile, stackwiseHome, writeProfile } from "@/local/home";
import { localOnly, readJson } from "@/mcp/local";

/**
 * Your profile in ~/.stackwise/profile.json: your name, the defaults for a new plan, who answers
 * in Ask, the theme, and the folders StackWise looks in for projects. This computer only.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const dir = stackwiseHome();
  return Response.json({ profile: readProfile(dir), dir, home: os.homedir(), account: accountName() });
}

export async function PUT(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = profileSchema.partial().safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "That isn't a change StackWise understands." }, { status: 400 });
  try {
    return Response.json({ profile: writeProfile(stackwiseHome(), parsed.data) });
  } catch {
    return Response.json({ error: "Couldn't write ~/.stackwise/profile.json." }, { status: 500 });
  }
}
