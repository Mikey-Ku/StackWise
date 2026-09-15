import fs from "node:fs";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { indexCatalog } from "@/engine/evaluate";
import { loadCatalog } from "@/engine/load";
import { createRegistry, projectPlanFileSchema, toProjectPlanFile, type PlanRecord } from "./registry";
import { createWhyStackServer } from "./server";

/**
 * WhyStack's MCP server as a command, for projects exported from WhyStack. The project's
 * .mcp.json runs `pnpm --silent --dir <WhyStack> mcp`, so this process starts in WhyStack's folder,
 * and Claude Code passes the project folder in CLAUDE_PROJECT_DIR. The project's
 * whystack.plan.json and WhyStack's shared copy are kept in step, so changes Claude makes here
 * show up in the WhyStack tab whenever it's open, and WhyStack doesn't need to be running.
 * Only JSON-RPC may go to stdout; anything else goes to stderr.
 */

const root = process.cwd();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.env.INIT_CWD ?? root;
const planPath = path.join(projectDir, "whystack.plan.json");
const registry = createRegistry(root);

function readProjectPlan() {
  try {
    return projectPlanFileSchema.parse(JSON.parse(fs.readFileSync(planPath, "utf8")));
  } catch {
    return null;
  }
}

function writeProjectPlan(record: PlanRecord) {
  fs.writeFileSync(planPath, `${JSON.stringify(toProjectPlanFile(record), null, 2)}\n`);
}

/** Whichever copy changed last wins: the project's file or WhyStack's. */
function syncedPlanId(): string | null {
  const file = readProjectPlan();
  if (!file) return registry.activeId();
  const record = registry.read(file.id);
  if (!record || Date.parse(file.updatedAt) > Date.parse(record.updatedAt)) {
    writeProjectPlan(registry.savePlan(file.id, file.plan, "claude"));
  } else if (record.version !== file.version || JSON.stringify(record.plan) !== JSON.stringify(file.plan)) {
    writeProjectPlan(record);
  }
  return file.id;
}

async function main() {
  const server = createWhyStackServer({
    index: () => indexCatalog(loadCatalog(path.join(root, "data"))),
    registry,
    planId: syncedPlanId,
    afterSave: (record) => {
      if (fs.existsSync(planPath)) writeProjectPlan(record);
    },
    whystackRoot: root,
    where: fs.existsSync(planPath) ? "project" : "app",
  });
  await server.connect(new StdioServerTransport());
  console.error(`WhyStack MCP server running for ${projectDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
