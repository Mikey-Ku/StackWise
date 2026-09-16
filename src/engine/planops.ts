import { z } from "zod";
import { costBySize, costOutlook, describeTotal } from "./cost";
import { optionIn, worstLevel, type CatalogIndex, type CheckResult, type Level } from "./evaluate";
import { questionsThatMatter } from "./followups";
import { closeCalls, criterionLabel, recommend, type Recommendation } from "./score";
import { PRIORITY_IDS, SIZE_IDS, SLOT_IDS, type Answer, type PlanInput, type Selection, type SlotId } from "./schema";
import { sharedPlanSchema, type SharedPlan } from "./share";
import { planStats } from "./stats";
import { connectionsOf } from "./wiring";
import { SIZE_PHRASE, inSentence } from "./text";

/**
 * Plans as something another program can read and change: what the MCP server gives Claude.
 * Every change goes through the same validation as the planner, and every report comes from the
 * same verdicts, costs and scores, so Claude can only ask WhyStack, never overrule it.
 */

const ANSWER_WORDS: Record<Answer, string> = { yes: "yes", no: "no", not_sure: "not sure" };
const LEVEL_ORDER: Record<Level, number> = { blocked: 0, missing: 1, warning: 2, unknown: 3, info: 4 };

export const planUpdateSchema = z.object({
  app_name: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  features: z.string().max(5000).optional(),
  answers: z.record(z.string(), z.enum(["yes", "no", "not_sure"])).optional(),
  /** An option id puts it in the part; "" keeps the part empty; null lets WhyStack pick again. */
  parts: z.partialRecord(z.enum(SLOT_IDS), z.string().max(80).nullable()).optional(),
  size: z.enum(SIZE_IDS).optional(),
  priority: z.enum(PRIORITY_IDS).optional(),
  builder: z.string().max(40).optional(),
});
export type PlanUpdate = z.infer<typeof planUpdateSchema>;

export class PlanUpdateError extends Error {}

export function planInput(plan: SharedPlan): PlanInput {
  return { answers: plan.answers, size: plan.size, priority: plan.priority };
}

/** Apply a change the way the planner would, or throw with every reason it can't be applied. */
export function applyPlanUpdate(index: CatalogIndex, plan: SharedPlan, update: PlanUpdate): { plan: SharedPlan; changes: string[] } {
  const next: SharedPlan = structuredClone(plan);
  const changes: string[] = [];
  const problems: string[] = [];
  const partLabel = (slot: SlotId) => index.slotsById.get(slot)?.label ?? slot;

  if (update.app_name !== undefined && update.app_name !== plan.appName) {
    next.appName = update.app_name;
    changes.push(`Renamed the app "${update.app_name}"`);
  }
  if (update.description !== undefined && update.description !== plan.description) {
    next.description = update.description;
    changes.push("Updated the description");
  }
  if (update.features !== undefined && update.features !== plan.features) {
    next.features = update.features;
    changes.push("Updated the features");
  }

  for (const [needId, answer] of Object.entries(update.answers ?? {})) {
    const need = index.needsById.get(needId);
    if (!need) {
      problems.push(`There's no question "${needId}". get_plan lists every question id.`);
      continue;
    }
    if (plan.answers[needId] === answer) continue;
    next.answers[needId] = answer;
    changes.push(`Answered "${need.question}" ${ANSWER_WORDS[answer]}`);
  }

  for (const [slot, value] of Object.entries(update.parts ?? {}) as [SlotId, string | null][]) {
    if (value === null) {
      if (plan.pinned[slot] === undefined) continue;
      delete next.pinned[slot];
      changes.push(`Let WhyStack pick ${inSentence(partLabel(slot))}`);
    } else if (value === "") {
      if (plan.pinned[slot] === "") continue;
      next.pinned[slot] = "";
      changes.push(`Cleared ${inSentence(partLabel(slot))}`);
    } else {
      const option = index.optionsById.get(value);
      if (!option) {
        problems.push(`There's no option "${value}". search_options lists option ids.`);
        continue;
      }
      if (!option.slots.includes(slot)) {
        problems.push(`${option.name} goes in ${option.slots.map((s) => partLabel(s)).join(" or ")}, not ${partLabel(slot)}.`);
        continue;
      }
      if (plan.pinned[slot] === value) continue;
      next.pinned[slot] = value;
      changes.push(`Put ${option.name} in ${partLabel(slot)}`);
    }
  }

  if (update.size && update.size !== plan.size) {
    next.size = update.size;
    changes.push(`Planned for ${SIZE_PHRASE[update.size]}`);
  }
  if (update.priority && update.priority !== plan.priority) {
    next.priority = update.priority;
    changes.push(`Set the priority to "${index.catalog.planning.priorities.find((p) => p.id === update.priority)?.label}"`);
  }
  if (update.builder && update.builder !== plan.builderId) {
    const builder = index.catalog.planning.builders.find((b) => b.id === update.builder);
    if (!builder) problems.push(`There's no builder "${update.builder}". Use one of: ${index.catalog.planning.builders.map((b) => b.id).join(", ")}.`);
    else {
      next.builderId = builder.id;
      changes.push(`Set the builder to ${builder.label}`);
    }
  }

  if (problems.length) throw new PlanUpdateError(problems.join(" "));
  return { plan: sharedPlanSchema.parse(next), changes };
}

export function checkReport(index: CatalogIndex, results: CheckResult[]) {
  return [...results]
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    .map((r) => ({
      level: r.level,
      title: r.title,
      explanation: r.explanation,
      ...(r.fix ? { fix: r.fix } : {}),
      parts: r.slots.map((s) => index.slotsById.get(s)?.label ?? s),
      ...(r.sources?.length ? { sources: r.sources } : {}),
      rule: r.ruleId,
    }));
}

export function stackReport(index: CatalogIndex, selection: Selection) {
  return SLOT_IDS.flatMap((slot) => {
    const option = optionIn(index, selection, slot);
    return option ? [{ part: slot, part_label: index.slotsById.get(slot)?.label ?? slot, option_id: option.id, option: option.name, researched: option.coverage === "full" }] : [];
  });
}

export function costReport(index: CatalogIndex, selection: Selection, input: PlanInput) {
  const outlook = costOutlook(index, selection, input);
  return {
    now: `For ${SIZE_PHRASE[input.size]}: ${describeTotal(outlook.now)}`,
    lines: [
      ...outlook.now.lines.map((l) => ({ part: index.slotsById.get(l.slot)?.label ?? l.slot, option: l.option.name, cost: l.headline, ...(l.detail ? { detail: l.detail } : {}) })),
      ...outlook.now.fees.map((f) => ({ part: index.slotsById.get(f.slot)?.label ?? f.slot, option: f.label, cost: `$${f.usd} ${f.per === "year" ? "a year" : "once"}`, detail: f.source })),
    ],
    by_size: costBySize(index, selection, input).map((s) => ({ size: SIZE_PHRASE[s.size], monthly: describeTotal(s, { monthlyOnly: true }) })),
    yearly_usd: outlook.now.yearlyUsd,
    one_time_usd: outlook.now.oneTimeUsd,
  };
}

/** Everything Claude needs to talk about a plan, from the same numbers the planner shows. */
export function planReport(index: CatalogIndex, plan: SharedPlan, rec: Recommendation = recommend(index, planInput(plan), plan.pinned)) {
  const input = planInput(plan);
  const matters = new Set(questionsThatMatter(index, input, plan.pinned));
  const stats = planStats(index, input, rec);
  return {
    app: plan.appName || "Untitled app",
    description: plan.description,
    features: plan.features,
    size: plan.size,
    priority: plan.priority,
    builder: plan.builderId,
    stack: stackReport(index, rec.selection).map((part) => ({ ...part, picked_by: rec.autoPicked.includes(part.part) ? "whystack" : "you" })),
    empty_parts_you_cleared: SLOT_IDS.filter((s) => plan.pinned[s] === "").map((s) => index.slotsById.get(s)?.label ?? s),
    verdict: worstLevel(rec.results),
    checks: checkReport(index, rec.results),
    close_calls: closeCalls(index, input, rec).map((c) => ({
      part: index.slotsById.get(c.slot)?.label ?? c.slot,
      chosen: c.chosen.name,
      runner_up: c.runnerUp.name,
      decided_by: ["tie", "accounts", "fewer_problems", "perks", "checks"].includes(c.decidedBy) ? c.decidedBy : criterionLabel(c.decidedBy as Parameters<typeof criterionLabel>[0], c.slot),
    })),
    cost: costReport(index, rec.selection, input),
    connections: connectionsOf(index, rec.selection).map((c) => ({
      part: index.slotsById.get(c.slot)?.label ?? c.slot,
      option: c.optionName,
      what_travels: c.what,
      environment_variables: c.env.map((v) => v.name),
    })),
    accounts_to_create: stats.accounts,
    setup_steps: stats.setupSteps,
    questions: index.catalog.needs.map((n) => ({
      id: n.id,
      question: n.question,
      answer: plan.answers[n.id] ?? null,
      ...(matters.has(n.id) ? { would_change_the_plan: true } : {}),
    })),
  };
}
