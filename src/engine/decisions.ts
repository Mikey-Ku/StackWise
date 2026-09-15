import { evaluatePlan, optionIn, worstLevel, type CatalogIndex, type CheckResult } from "./evaluate";
import { BUILD_ORDER } from "./checklist";
import { alternativesFor, CRITERIA, criterionLabel, criterionScores, scorePlan, weightsFor } from "./score";
import type { PlanInput, Selection, SlotId } from "./schema";

/**
 * The reasoning export for experienced users: one decision record per part of the stack, in the
 * shape of an architecture decision record. Everything in it comes from the same verdicts and
 * scores the canvas shows, so it can be pasted into a pull request or a proposal as-is.
 */

const LEVEL_WORDS: Record<string, string> = {
  works: "works",
  info: "works",
  warning: "works with a warning",
  unknown: "not verified yet",
  missing: "missing a piece",
  blocked: "doesn't work",
};

function resultLine(r: CheckResult): string {
  const label = r.level === "info" ? "Note" : LEVEL_WORDS[r.level];
  return `- ${label[0].toUpperCase()}${label.slice(1)}: **${r.title}.** ${r.explanation}`;
}

export function slotReasoning(index: CatalogIndex, input: PlanInput, selection: Selection, slot: SlotId): string | null {
  const option = optionIn(index, selection, slot);
  const def = index.slotsById.get(slot);
  if (!option || !def) return null;

  const priority = index.catalog.planning.priorities.find((p) => p.id === input.priority);
  const weights = weightsFor(index, input.priority);
  const results = evaluatePlan(index, selection, input).filter((r) => r.slots.includes(slot));
  const scores = criterionScores(index, option, slot, input);
  const strengths = CRITERIA.filter((c) => scores[c] >= 0.6 && weights[c] > 0)
    .sort((a, b) => scores[b] * weights[b] - scores[a] * weights[a])
    .map((c) => criterionLabel(c, slot));

  const alternatives = alternativesFor(index, input, selection, slot).filter((a) => a.option.id !== option.id);
  const considered = alternatives.filter((a) => a.option.coverage === "full").slice(0, 4);

  const changes: string[] = [];
  for (const other of index.catalog.planning.priorities) {
    if (other.id === input.priority) continue;
    const alt = { ...input, priority: other.id };
    const best = alternativesFor(index, alt, selection, slot).find((a) => a.option.coverage === "full" && a.worst !== "blocked");
    if (best && best.option.id !== option.id && best.delta > 1e-9) {
      changes.push(`If "${other.label}" mattered most, ${best.option.name} would score higher.`);
    }
  }
  for (const blocked of alternatives.filter((a) => a.worst === "blocked").slice(0, 3)) {
    const reason = blocked.results.find((r) => r.level === "blocked");
    if (reason) changes.push(`${blocked.option.name} is ruled out with this plan: ${reason.title.toLowerCase()}.`);
  }

  const sources = Object.entries(option.facts).map(([key, fact]) => `- ${index.catalog.facts[key]?.label ?? key}: ${fact.source} (${fact.status}, ${fact.retrieved})`);
  const current = scorePlan(index, selection, input, evaluatePlan(index, selection, input)).total;

  return [
    `## ${def.label}: ${option.name}`,
    "",
    `**Status:** ${LEVEL_WORDS[worstLevel(results)]}.`,
    "",
    `**Why:** ${strengths.length ? strengths.join(", ") : option.summary} (priority: ${priority?.label ?? input.priority}).`,
    "",
    "**Checks on this part:**",
    "",
    ...(results.length ? results.map(resultLine) : ["- No rule found a problem."]),
    "",
    "**Alternatives considered:**",
    "",
    ...(considered.length
      ? [
          "| Option | With this plan | Plan score if swapped |",
          "|---|---|---|",
          ...considered.map((a) => `| ${a.option.name} | ${LEVEL_WORDS[a.worst]} | ${(current + a.delta).toFixed(1)} (${a.delta >= 0 ? "+" : ""}${a.delta.toFixed(1)}) |`),
        ]
      : ["- None with researched facts."]),
    "",
    "**What would change this decision:**",
    "",
    ...(changes.length ? changes.map((c) => `- ${c}`) : ["- Nothing among the priorities WhyStack measures."]),
    "",
    "**Sources:**",
    "",
    ...(sources.length ? sources : ["- No researched facts yet."]),
    "",
  ].join("\n");
}

export function buildDecisionRecord(
  index: CatalogIndex,
  input: PlanInput,
  selection: Selection,
  details: { appName: string; generatedOn: string },
): string {
  const sections = BUILD_ORDER.map((slot) => slotReasoning(index, input, selection, slot)).filter((s): s is string => Boolean(s));
  return [
    `# ${details.appName.trim() || "My app"}: stack decisions`,
    "",
    `> Written by WhyStack on ${details.generatedOn} from the same rules and scores as the plan. Facts marked draft haven't been reviewed by a person yet.`,
    "",
    ...sections,
  ].join("\n");
}
