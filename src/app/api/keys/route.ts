import { z } from "zod";
import { resetClient } from "@/ai/config";
import { PROVIDER_KEY_NAMES, providerStatus } from "@/ai/providers";
import { localOnly, readJson } from "@/mcp/local";
import { writeEnv } from "@/project/local";

/**
 * Saving a built-in AI's key from the Connect screen, instead of editing .env.local by hand. Only
 * answers this computer, only writes the provider key names in PROVIDERS, and writes them to
 * StackWise's own .env.local (created readable only by you). The key is used at once, with no
 * restart, and never comes back: the response has names and on or off, like /api/status.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().max(80),
  /** An empty value turns the provider off. */
  value: z.string().max(1000),
});

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "Send { name, value }." }, { status: 400 });
  const { name } = parsed.data;
  const value = parsed.data.value.trim();
  if (!PROVIDER_KEY_NAMES.has(name)) return Response.json({ error: `StackWise only saves AI keys here, and ${name} isn't one.` }, { status: 400 });
  if (/[\r\n]/.test(value)) return Response.json({ error: "A key is one line." }, { status: 400 });

  try {
    const { ignored } = writeEnv(process.cwd(), name, value);
    if (value) process.env[name] = value;
    else delete process.env[name];
    resetClient();
    return Response.json({ saved: name, ignored, providers: providerStatus() });
  } catch {
    return Response.json({ error: "Couldn't write StackWise's .env.local." }, { status: 500 });
  }
}
