import type { DiskLibrary } from "@/components/library";
import { homeRegistry } from "@/mcp/registry";
import { readLibraryIndex, stackwiseHome } from "./home";

/**
 * Node-only. The library as the app reads it: every plan in ~/.stackwise/plans with which one is
 * open and their order. The Projects page renders from this on the server, so it comes up with
 * the plans already there, and /api/library hands the browser the same thing.
 */
export function readDiskLibrary(root: string): DiskLibrary {
  const registry = homeRegistry(root);
  const index = readLibraryIndex(stackwiseHome());
  return {
    activeId: index.activeId,
    order: index.order,
    plans: registry.list().map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedBy, plan: r.plan, local: (r.local ?? null) as DiskLibrary["plans"][number]["local"] })),
  };
}
