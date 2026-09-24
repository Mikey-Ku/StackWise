import { sharedPlanSchema, type SharedPlan } from "@/engine";
import { toSharedPlan, type PlanState, type Store, type StoreAction } from "./store";
import { downloadText } from "./ui";

/**
 * Moving applications in and out of this browser: plan files and shared plans. The plan menu and
 * the applications page both use these, so an import reads the same wherever it starts.
 */

/** A shared plan named like one already here gets " (shared)", so the two can be told apart. */
export function sharedName(plan: SharedPlan, plans: Record<string, PlanState>): SharedPlan {
  const name = plan.appName.trim();
  if (!name || !Object.values(plans).some((p) => p.appName.trim() === name)) return plan;
  return { ...plan, appName: `${name} (shared)` };
}

/** Downloads the plan as `<name>.stackwise.json`. */
export function downloadPlanFile(plan: PlanState): void {
  const slug = (plan.appName.trim() || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  downloadText(`${slug}.stackwise.json`, JSON.stringify({ stackwise: "plan", ...toSharedPlan(plan) }, null, 2), "application/json");
}

/**
 * What opening a plan file does: the store actions to run and what to tell the person. A project's
 * stackwise.plan.json keeps its plan id, so opening it again updates that plan instead of copying it.
 */
export async function readPlanFile(file: File, store: Store, newId: () => string): Promise<{ actions: StoreAction[]; message: string }> {
  const now = new Date().toISOString();
  try {
    const raw = JSON.parse(await file.text()) as { stackwise?: unknown; whystack?: unknown; id?: unknown; plan?: unknown };
    if ((raw.stackwise === 1 || raw.whystack === 1) && raw.plan && typeof raw.id === "string") {
      const parsed = sharedPlanSchema.safeParse(raw.plan);
      if (!parsed.success) throw new Error("not a plan");
      if (store.plans[raw.id]) {
        return {
          actions: [
            { type: "switchPlan", id: raw.id },
            { type: "applyRemote", id: raw.id, plan: parsed.data },
          ],
          message: `Updated ${parsed.data.appName || "the application"} from its project file.`,
        };
      }
      return {
        actions: [{ type: "importPlan", id: /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : newId(), now, plan: parsed.data }],
        message: `Opened ${parsed.data.appName || "an application"} from its project file.`,
      };
    }
    const parsed = sharedPlanSchema.safeParse(raw);
    if (!parsed.success) throw new Error("not a plan");
    const plan = sharedName(parsed.data, store.plans);
    return { actions: [{ type: "importPlan", id: newId(), now, plan }], message: `Opened ${plan.appName || "an application"}.` };
  } catch {
    return { actions: [], message: "That file isn't a StackWise plan." };
  }
}
