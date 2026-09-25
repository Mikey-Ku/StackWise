import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { indexCatalog } from "@/engine/evaluate";
import { loadCatalog } from "@/engine/load";
import { localOnly } from "@/mcp/local";
import { createRegistry } from "@/mcp/registry";
import { createStackWiseServer } from "@/mcp/server";

/**
 * StackWise's MCP server over HTTP, for Claude to pair on the plan open in StackWise:
 *   claude mcp add --transport http --scope user stackwise http://127.0.0.1:4310/api/mcp
 * 127.0.0.1, not localhost: see mcpAddress in src/mcp/pairing.ts. Stateless: each request gets a fresh server, and the shared plan lives in .stackwise/.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const root = process.cwd();
  const registry = createRegistry(root);
  const server = createStackWiseServer({
    index: () => indexCatalog(loadCatalog()),
    registry,
    planId: () => registry.activeId(),
    stackwiseRoot: root,
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
