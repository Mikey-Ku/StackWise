import { setting } from "@/engine/names";

/**
 * StackWise's API writes files, starts processes, saves keys and spends AI credit, so it only
 * answers StackWise's own page and programs on this computer. Three layers:
 *
 * - The server listens on 127.0.0.1 only (package.json), so nothing on the network reaches it.
 * - The Host header must be a loopback name, which stops DNS rebinding (a website pointing its
 *   own name at 127.0.0.1).
 * - A browser request must come from StackWise's own page: same host and port in Origin, and
 *   "same-origin" in Sec-Fetch-Site when the browser sends it. Another app on localhost:5173 is a
 *   different origin. A POST must be JSON, so a page elsewhere can't send a "simple" request that
 *   skips the browser's preflight. Programs like Claude Code send no Origin and are let through.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The most a request body may be. Plans, notes and conversations fit well inside it. */
export const MAX_BODY_BYTES = 512 * 1024;

function address(value: string): { name: string; port: string } | null {
  try {
    const url = new URL(value);
    const name = url.hostname.includes(":") && !url.hostname.startsWith("[") ? `[${url.hostname}]` : url.hostname;
    return { name, port: url.port || (url.protocol === "https:" ? "443" : "80") };
  } catch {
    return null;
  }
}

const refuse = (status: number, error: string) => Response.json({ error }, { status });

/** Null when the request comes from StackWise's own page or a program on this computer; otherwise the refusal. */
export function sameOrigin(request: Request): Response | null {
  const host = address(`http://${request.headers.get("host") ?? ""}`);
  if (!host || !LOCAL_HOSTS.has(host.name)) return refuse(403, "StackWise only answers requests from this computer.");
  const origin = request.headers.get("origin");
  if (origin !== null) {
    const from = address(origin);
    if (!from || !LOCAL_HOSTS.has(from.name) || from.port !== host.port) return refuse(403, "StackWise only answers its own page.");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse(403, "StackWise only answers its own page.");
  if (request.method === "POST" && !(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return refuse(415, "Send JSON.");
  }
  return null;
}

/** The guard for pairing, the MCP server and the routes that change things on disk. */
export function localOnly(request: Request): Response | null {
  if (setting("PAIRING") === "off") {
    return refuse(404, "Agent pairing is off on this server (STACKWISE_PAIRING=off).");
  }
  return sameOrigin(request);
}

/** The request's JSON, or null when it isn't JSON or is bigger than MAX_BODY_BYTES. */
export async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
