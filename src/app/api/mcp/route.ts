import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { indexCatalog } from "@/engine/evaluate";
import { loadCatalog } from "@/engine/load";
import { localOnly } from "@/mcp/local";
import { createRegistry } from "@/mcp/registry";
import { createWhyStackServer } from "@/mcp/server";

/**
 * WhyStack's MCP server over HTTP, for Claude to pair on the plan open in WhyStack:
 *   claude mcp add --transport http --scope user whystack http://localhost:4310/api/mcp
 * Stateless: each request gets a fresh server, and the shared plan lives in .whystack/.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const root = process.cwd();
  const registry = createRegistry(root);
  const server = createWhyStackServer({
    index: () => indexCatalog(loadCatalog()),
    registry,
    planId: () => registry.activeId(),
    whystackRoot: root,
    where: "app",
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export { handle as DELETE, handle as GET, handle as POST };
