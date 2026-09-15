import { costOutlook, describeTotal } from "./cost";
import { needIsOn, optionIn, type CatalogIndex } from "./evaluate";
import { BUILD_ORDER } from "./checklist";
import { closeCalls, type Recommendation } from "./score";
import type { PlanInput } from "./schema";

/**
 * Everything an explanation of the plan is allowed to say, as plain data. The AI explanation is
 * written only from this, and the template explanation (used when AI is off) reads the same thing.
 */

export interface PlanBrief {
  app: string;
  description: string;
  needs: string[];
  stack: { part: string; choice: string; status: string }[];
  problems: { title: string; explanation: string; fix?: string }[];
  notes: string[];
  cost: { now: string; next?: string };
  closeCalls: string[];
}

const STATUS: Record<string, string> = {
  blocked: "doesn't work",
  missing: "missing",
  warning: "works with a warning",
  unknown: "not verified yet",
};

export function planBrief(index: CatalogIndex, input: PlanInput, rec: Recommendation, appName: string, description: string): PlanBrief {
  const { catalog } = index;
  const sizeLabel = (id: string) => catalog.planning.sizes.find((s) => s.id === id)?.label.toLowerCase() ?? id;
  const outlook = costOutlook(index, rec.selection, input);

  const stack = BUILD_ORDER.flatMap((slot) => {
    const option = optionIn(index, rec.selection, slot);
    if (!option) return [];
    const touching = rec.results.filter((r) => r.slots.includes(slot) && r.level !== "info");
    const worst = touching.find((r) => r.level === "blocked") ?? touching.find((r) => r.level === "warning") ?? touching[0];
    return [{ part: index.slotsById.get(slot)?.label ?? slot, choice: option.name, status: worst ? STATUS[worst.level] : "works" }];
  });

  return {
    app: appName.trim() || "This app",
    description: description.trim(),
    needs: catalog.needs.filter((n) => needIsOn(index, input, n.id)).map((n) => n.label.toLowerCase()),
    stack,
    problems: rec.results
      .filter((r) => r.level !== "info")
      .map((r) => ({ title: r.title, explanation: r.explanation, fix: r.fix })),
    notes: rec.results.filter((r) => r.level === "info").map((r) => r.title),
    cost: {
      now: `At ${sizeLabel(outlook.now.size)} people: ${describeTotal(outlook.now)}`,
      next: outlook.next ? `At ${sizeLabel(outlook.next.size)} people: ${describeTotal(outlook.next)}` : undefined,
    },
    closeCalls: closeCalls(index, input, rec).map((c) => `${c.chosen.name} was a close call against ${c.runnerUp.name} for ${index.slotsById.get(c.slot)?.label.toLowerCase()}`),
  };
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The no-AI explanation: the same brief, in fixed sentences. */
export function templateSummary(brief: PlanBrief): string {
  const parts = brief.stack.map((s) => `${s.choice} for ${s.part.toLowerCase()}`);
  const first = `${brief.app} is planned with ${list(parts)}.`;
  const needs = brief.needs.length ? ` It was shaped by what you said the app needs: ${list(brief.needs)}.` : "";
  const problems = brief.problems.length
    ? `The most important thing to look at: ${brief.problems[0].title.toLowerCase()}. ${brief.problems[0].fix ?? brief.problems[0].explanation}${
        brief.problems.length > 1 ? ` There ${brief.problems.length === 2 ? "is 1 more thing" : `are ${brief.problems.length - 1} more things`} listed in the planner.` : ""
      }`
    : "Every connection in the plan checks out.";
  const cost = `${brief.cost.now}.${brief.cost.next ? ` ${brief.cost.next}.` : ""}`;
  return [`${first}${needs}`, problems, cost].join("\n\n");
}
