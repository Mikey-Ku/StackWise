import fs from "node:fs";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { indexCatalog } from "@/engine/evaluate";
import { loadCatalog } from "@/engine/load";
import { mergePlans } from "@/engine/merge";
import { createRegistry, projectPlanFileSchema, toProjectPlanFile, type PlanRecord } from "./registry";
import { createStackWiseServer } from "./server";
import { LEGACY_PLAN_FILE, PLAN_FILE } from "@/engine/names";

/**
 * StackWise's MCP server as a command, for projects exported from StackWise. The project's
 * .mcp.json runs `pnpm --silent --dir <StackWise> mcp`, so this process starts in StackWise's folder,
 * and Claude Code passes the project folder in CLAUDE_PROJECT_DIR. The project's
 * stackwise.plan.json and StackWise's shared copy are kept in step, so changes Claude makes here
 * show up in the StackWise tab whenever it's open, and StackWise doesn't need to be running.
 * Only JSON-RPC may go to stdout; anything else goes to stderr.
 */

const root = process.cwd();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.env.INIT_CWD ?? root;
const planPath = path.join(projectDir, PLAN_FILE);
// A project exported while StackWise was called WhyStack: its plan file takes the new name.
const legacyPlanPath = path.join(projectDir, LEGACY_PLAN_FILE);
if (!fs.existsSync(planPath) && fs.existsSync(legacyPlanPath)) {
  fs.renameSync(legacyPlanPath, planPath);
  console.error(`Renamed ${LEGACY_PLAN_FILE} to ${PLAN_FILE}.`);
}
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

/**
 * The project's file and StackWise's copy, merged. Both can change between calls: an agent in this
 * terminal edits the file, and the browser (or another agent paired over HTTP) changes StackWise's
 * copy. A three-way merge against the last copy both had keeps both sides' changes; only a key
 * both changed differently goes to the newer side, and the activity log says which.
 */
function syncedPlanId(): string | null {
  const file = readProjectPlan();
  if (!file) return registry.activeId();
  const record = registry.read(file.id);
  if (!record) {
    const saved = registry.savePlan(file.id, file.plan, "claude");
    registry.setSynced(file.id, saved.plan);
    writeProjectPlan(saved);
    return file.id;
  }
  if (JSON.stringify(record.plan) === JSON.stringify(file.plan)) {
    if (record.version !== file.version) writeProjectPlan(record);
    registry.setSynced(file.id, record.plan);
    return file.id;
  }
  const fileNewer = Date.parse(file.updatedAt) > Date.parse(record.updatedAt);
  // Without a remembered base, the older copy is the best guess at what both started from.
  const base = record.synced ?? (fileNewer ? record.plan : file.plan);
  const { plan, conflicts } = mergePlans(base, file.plan, record.plan, fileNewer);
  const saved = registry.savePlan(file.id, plan, "claude", {
    tool: "sync_plan_file",
    summary: conflicts.length ? `Merged stackwise.plan.json with StackWise's copy. Both changed ${conflicts.join(", ")}, and the newer one was kept.` : "Merged stackwise.plan.json with StackWise's copy.",
    changes: [],
  });
  registry.setSynced(file.id, saved.plan);
  writeProjectPlan(saved);
  return file.id;
}

async function main() {
  const server = createStackWiseServer({
    index: () => indexCatalog(loadCatalog(path.join(root, "data"))),
    registry,
    planId: syncedPlanId,
    afterSave: (record) => {
      if (fs.existsSync(planPath)) writeProjectPlan(record);
    },
    stackwiseRoot: root,
    projectDir,
    where: fs.existsSync(planPath) ? "project" : "app",
  });
  await server.connect(new StdioServerTransport());
  console.error(`StackWise MCP server running for ${projectDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
