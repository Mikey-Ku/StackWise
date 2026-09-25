import { planInput, type ReviewDefault } from "@/engine";
import { DEMOS } from "./demos";
import { blankPlan } from "./store";
import { TEMPLATES } from "./templates";

/**
 * The plans people start from: each template, as a new plan with that template applied, and each
 * demo. The fact review (/review) puts the facts behind their picks first. A new template or demo
 * joins the list on its own.
 */
export function defaultPlans(): ReviewDefault[] {
  const { size, priority } = blankPlan("", "");
  return [
    ...TEMPLATES.map((t) => ({ label: t.label, input: { answers: t.answers, size, priority }, pinned: t.pinned })),
    ...DEMOS.map((d) => ({ label: `${d.plan.appName} example`, input: planInput(d.plan), pinned: d.plan.pinned })),
  ];
}
