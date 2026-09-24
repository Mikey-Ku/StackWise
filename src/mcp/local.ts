import { setting } from "@/engine/names";

/**
 * The MCP endpoint and pairing API change plans on disk, so they only answer this computer. The
 * Host check stops DNS rebinding (a website pointing its own name at 127.0.0.1), and the Origin
 * check stops a page open in a browser tab from posting to localhost.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostname(value: string): string | null {
  try {
    const { hostname: name } = new URL(value);
    return name.includes(":") && !name.startsWith("[") ? `[${name}]` : name;
  } catch {
    return null;
  }
}

export function localOnly(request: Request): Response | null {
  if (setting("PAIRING") === "off") {
    return Response.json({ error: "Agent pairing is off on this server (STACKWISE_PAIRING=off)." }, { status: 404 });
  }
  const host = hostname(`http://${request.headers.get("host") ?? ""}`);
  const origin = request.headers.get("origin");
  const originHost = origin ? hostname(origin) : null;
  if (!host || !LOCAL_HOSTS.has(host) || (origin !== null && (!originHost || !LOCAL_HOSTS.has(originHost)))) {
    return Response.json({ error: "StackWise's MCP server and pairing only answer requests from this computer." }, { status: 403 });
  }
  return null;
}
