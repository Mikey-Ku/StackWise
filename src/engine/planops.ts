import { z } from "zod";
import { costBySize, costOutlook, describeTotal } from "./cost";
import { optionIn, worstLevel, type CatalogIndex, type CheckResult, type Level } from "./evaluate";
import { questionsThatMatter } from "./followups";
import { closeCalls, criterionLabel, recommend, type Recommendation } from "./score";
import { PRIORITY_IDS, SIZE_IDS, SLOT_IDS, type Answer, type PlanInput, type Selection, type SlotId } from "./schema";
import { CUSTOM_ID, NOTE_MAX, customPartSchema, sharedPlanSchema, type SharedPlan } from "./share";
import { isOwn } from "./own";
import { pickReason } from "./spec";
import { planStats } from "./stats";
import { connectionsOf } from "./wiring";
import { SIZE_PHRASE, inSentence } from "./text";

/**
 * Plans as something another program can read and change: what the MCP server gives Claude.
 * Every change goes through the same validation as the planner, and every report comes from the
 * same verdicts, costs and scores, so Claude can only ask StackWise, never overrule it.
 */

const ANSWER_WORDS: Record<Answer, string> = { yes: "yes", no: "no", not_sure: "not sure" };
const LEVEL_ORDER: Record<Level, number> = { blocked: 0, missing: 1, warning: 2, unknown: 3, info: 4 };

export const planUpdateSchema = z.object({
  app_name: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  features: z.string().max(5000).optional(),
  answers: z.record(z.string(), z.enum(["yes", "no", "not_sure"])).optional(),
  /** An option id puts it in the part; "" keeps the part empty; null lets StackWise pick again. */
  parts: z.partialRecord(z.enum(SLOT_IDS), z.string().max(80).nullable()).optional(),
  size: z.enum(SIZE_IDS).optional(),
  priority: z.enum(PRIORITY_IDS).optional(),
  builder: z.string().max(40).optional(),
  /** Notes by part id. Text replaces the note; "" removes it. */
  notes: z.partialRecord(z.enum(SLOT_IDS), z.string().max(NOTE_MAX)).optional(),
  /** Parts StackWise doesn't list, by id ("custom-<name>"): an object adds or replaces one, null removes it. Never checked or priced. */
  custom: z.record(z.string().regex(CUSTOM_ID), customPartSchema.nullable()).optional(),
});
export type PlanUpdate = z.infer<typeof planUpdateSchema>;

export class PlanUpdateError extends Error {}

export function planInput(plan: SharedPlan): PlanInput {
  return { answers: plan.answers, size: plan.size, priority: plan.priority };
}

/** Apply a change the way the planner would, or throw with every reason it can't be applied. */
export function applyPlanUpdate(index: CatalogIndex, plan: SharedPlan, update: PlanUpdate, now = new Date().toISOString()): { plan: SharedPlan; changes: string[] } {
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
      changes.push(`Let StackWise pick ${inSentence(partLabel(slot))}`);
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

  // Notes go last, so a note written for a part that changes in the same update names the new option.
  const selection = Object.keys(update.notes ?? {}).length ? recommend(index, planInput(next), next.pinned).selection : {};
  for (const [slot, text] of Object.entries(update.notes ?? {}) as [SlotId, string][]) {
    const trimmed = text.trim();
    const current = plan.notes[slot];
    if (!trimmed) {
      if (!current) continue;
      delete next.notes[slot];
      changes.push(`Removed the note on ${partLabel(slot)}`);
      continue;
    }
    if (current?.text === trimmed) continue;
    next.notes[slot] = { text: trimmed, optionId: selection[slot] || undefined, updatedAt: now, by: "claude" };
    changes.push(`${current ? "Rewrote" : "Wrote"} the note on ${partLabel(slot)}`);
  }

  for (const [id, part] of Object.entries(update.custom ?? {})) {
    const current = plan.custom?.[id];
    if (part === null) {
      if (!current) continue;
      delete next.custom![id];
      changes.push(`Removed ${current.name}, added by hand`);
      continue;
    }
    if (JSON.stringify(current) === JSON.stringify(part)) continue;
    next.custom = { ...next.custom, [id]: part };
    changes.push(`${current ? "Updated" : "Added"} ${part.name} as a part StackWise doesn't check`);
  }

  if (problems.length) throw new PlanUpdateError(problems.join(" "));
  return { plan: sharedPlanSchema.parse(next), changes };
}

/**
 * Reports are read by coding agents on every turn, so they stay lean: part ids (which update_plan
 * takes) instead of repeating labels, flags only when they say something, and a "full" detail for
 * the rare call that needs every sentence.
 */
export type ReportDetail = "summary" | "full";

export function checkReport(index: CatalogIndex, results: CheckResult[]) {
  return [...results]
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    .map((r) => ({
      level: r.level,
      title: r.title,
      explanation: r.explanation,
      ...(r.fix ? { fix: r.fix } : {}),
      parts: r.slots,
      ...(r.sources?.length ? { sources: r.sources } : {}),
      rule: r.ruleId,
    }));
}

/** The stack as part ids and options. `researched: false` flags an option whose facts aren't all in. */
export function stackReport(index: CatalogIndex, selection: Selection) {
  return SLOT_IDS.flatMap((slot) => {
    const option = optionIn(index, selection, slot);
    return option ? [{ part: slot, option_id: option.id, option: option.name, ...(option.coverage === "full" ? {} : { researched: false }) }] : [];
  });
}

export function costReport(index: CatalogIndex, selection: Selection, input: PlanInput, detail: ReportDetail = "full") {
  const outlook = costOutlook(index, selection, input);
  const total = { now: `For ${SIZE_PHRASE[input.size]}: ${describeTotal(outlook.now)}`, yearly_usd: outlook.now.yearlyUsd, one_time_usd: outlook.now.oneTimeUsd };
  if (detail === "summary") {
    // One line per part, e.g. "payments (Stripe): Pay per sale: 2.9% + 30¢". estimate_costs has the details and every size.
    return {
      ...total,
      lines: [...outlook.now.lines.map((l) => `${l.slot} (${l.option.name}): ${l.headline}`), ...outlook.now.fees.map((f) => `${f.slot} (${f.label}): $${f.usd} ${f.per === "year" ? "a year" : "once"}`)],
    };
  }
  return {
    ...total,
    lines: [
      ...outlook.now.lines.map((l) => ({ part: l.slot, option: l.option.name, cost: l.headline, ...(l.detail ? { detail: l.detail } : {}) })),
      ...outlook.now.fees.map((f) => ({ part: f.slot, option: f.label, cost: `$${f.usd} ${f.per === "year" ? "a year" : "once"}`, detail: f.source })),
    ],
    by_size: costBySize(index, selection, input).map((s) => ({ size: SIZE_PHRASE[s.size], monthly: describeTotal(s, { monthlyOnly: true }) })),
  };
}

/**
 * Everything an agent needs to talk about a plan, from the same numbers the planner shows.
 * "summary" (what get_plan returns by default) leaves out the wiring, cost details and the text of
 * questions that don't change the plan; "full" has all of it.
 */
export function planReport(index: CatalogIndex, plan: SharedPlan, rec: Recommendation = recommend(index, planInput(plan), plan.pinned), detail: ReportDetail = "full") {
  const input = planInput(plan);
  const matters = questionsThatMatter(index, input, plan.pinned);
  const stats = planStats(index, input, rec);
  const full = detail === "full";
  const report = {
    app: plan.appName || "Untitled app",
    description: plan.description,
    features: plan.features,
    size: plan.size,
    priority: plan.priority,
    builder: plan.builderId,
    stack: stackReport(index, rec.selection).map((part) => ({ ...part, picked_by: rec.autoPicked.includes(part.part) ? "whystack" : "you" })),
    // Parts added by hand: StackWise has no facts on them, so they're listed, never checked or priced.
    ...(Object.keys(plan.custom ?? {}).length
      ? { custom_parts: Object.entries(plan.custom ?? {}).map(([id, part]) => ({ id, name: part.name, ...(part.role ? { role: part.role } : {}), ...(part.env.length ? { env: part.env } : {}), ...(full && part.url ? { url: part.url } : {}), ...(full && part.note ? { note: part.note } : {}) })) }
      : {}),
    empty_parts_you_cleared: SLOT_IDS.filter((s) => plan.pinned[s] === ""),
    verdict: worstLevel(rec.results),
    checks: checkReport(index, rec.results),
    close_calls: closeCalls(index, input, rec).map((c) => ({
      part: c.slot,
      chosen: c.chosen.name,
      runner_up: c.runnerUp.name,
      decided_by: ["tie", "accounts", "fewer_problems", "perks", "checks", "starting_pick"].includes(c.decidedBy) ? c.decidedBy : criterionLabel(c.decidedBy as Parameters<typeof criterionLabel>[0], c.slot),
    })),
    cost: costReport(index, rec.selection, input, detail),
    notes: SLOT_IDS.flatMap((slot) => {
      const note = plan.notes[slot];
      if (!note) return [];
      const optionNow = rec.selection[slot];
      const writtenFor = note.optionId ? index.optionsById.get(note.optionId)?.name ?? note.optionId : undefined;
      return [
        {
          part_id: slot,
          text: note.text,
          written_by: note.by,
          ...(full ? { part: index.slotsById.get(slot)?.label ?? slot, updated_at: note.updatedAt } : {}),
          ...(note.optionId && note.optionId !== optionNow ? { written_for: writtenFor, may_be_out_of_date: true } : {}),
        },
      ];
    }),
    accounts_to_create: stats.accounts,
    setup_steps: stats.setupSteps,
  };
  if (!full) {
    return {
      ...report,
      answers: plan.answers,
      // Unanswered questions whose answer would change the stack or its checks. get_plan with detail "full" lists every question.
      questions_that_matter: matters.map((id) => ({ id, question: index.needsById.get(id)?.question ?? id })),
    };
  }
  return {
    ...report,
    connections: connectionsOf(index, rec.selection).map((c) => ({ part: c.slot, option: c.optionName, what_travels: c.what, environment_variables: c.env.map((v) => v.name) })),
    questions: index.catalog.needs.map((n) => ({
      id: n.id,
      question: n.question,
      answer: plan.answers[n.id] ?? null,
      ...(matters.includes(n.id) ? { would_change_the_plan: true } : {}),
    })),
  };
}

/**
 * What an update did to the plan, so an agent can tell the person without reading the plan again:
 * parts that changed, checks that appeared or went away, the verdict and the cost before and after.
 */
export function planDiff(index: CatalogIndex, before: { plan: SharedPlan; rec: Recommendation }, after: { plan: SharedPlan; rec: Recommendation }) {
  const name = (id: string | undefined) => (id ? index.optionsById.get(id)?.name ?? id : null);
  const parts = SLOT_IDS.filter((s) => (before.rec.selection[s] ?? "") !== (after.rec.selection[s] ?? "")).map((s) => ({
    part: s,
    from: name(before.rec.selection[s]),
    to: name(after.rec.selection[s]),
  }));
  const beforeKeys = new Set(before.rec.results.map((r) => r.key));
  const afterKeys = new Set(after.rec.results.map((r) => r.key));
  const verdict = { before: worstLevel(before.rec.results), after: worstLevel(after.rec.results) };
  const costBefore = costReport(index, before.rec.selection, planInput(before.plan), "summary").now;
  const costAfter = costReport(index, after.rec.selection, planInput(after.plan), "summary").now;
  const staleNotes = SLOT_IDS.filter((s) => {
    const note = after.plan.notes[s];
    return note?.optionId && note.optionId !== after.rec.selection[s] && before.rec.selection[s] !== after.rec.selection[s];
  });
  return {
    verdict: verdict.before === verdict.after ? verdict.after : `${verdict.before} -> ${verdict.after}`,
    ...(parts.length ? { parts_changed: parts } : {}),
    ...(after.rec.results.some((r) => !beforeKeys.has(r.key)) ? { new_checks: checkReport(index, after.rec.results.filter((r) => !beforeKeys.has(r.key))) } : {}),
    ...(before.rec.results.some((r) => !afterKeys.has(r.key)) ? { resolved_checks: before.rec.results.filter((r) => !afterKeys.has(r.key)).map((r) => r.title) } : {}),
    cost: costBefore === costAfter ? costAfter : { before: costBefore, after: costAfter },
    ...(staleNotes.length ? { notes_to_review: staleNotes } : {}),
  };
}

/**
 * The plan as a coding agent should hold it: the diagram (the app in the middle, one line to each
 * part, lines between two parts only where a check found a problem) and the reasoning behind every
 * pick, in a few hundred tokens of plain text. Everything in it comes from the rules and facts; an
 * agent that needs a value's source calls get_option.
 */
export function planDigest(index: CatalogIndex, plan: SharedPlan, rec: Recommendation = recommend(index, planInput(plan), plan.pinned)): string {
  const input = planInput(plan);
  const label = (slot: SlotId) => index.slotsById.get(slot)?.label ?? slot;
  const clip = (text: string, max: number) => {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
  };
  const outlook = costOutlook(index, rec.selection, input);
  const costOf = new Map(outlook.now.lines.map((l) => [l.slot, l.headline]));
  const calls = new Map(closeCalls(index, input, rec).map((c) => [c.slot, c]));
  const framework = optionIn(index, rec.selection, "framework");

  const lines = [
    `${plan.appName || "Untitled app"}: ${framework?.name ?? "no framework yet"}, for ${SIZE_PHRASE[plan.size]}, priority ${plan.priority}. Verdict: ${worstLevel(rec.results)}. ${describeTotal(outlook.now)}.`,
    "Diagram: the app in the middle with one line to each part (the app uses it). A line between two parts means a problem between them.",
    "Parts (part: option [verdict] picked by: why | cost | note):",
  ];
  for (const slot of SLOT_IDS) {
    const option = optionIn(index, rec.selection, slot);
    if (!option) {
      if (rec.needed.includes(slot) && plan.pinned[slot] !== "") lines.push(`- ${slot}: EMPTY, the answers need ${inSentence(label(slot))}`);
      continue;
    }
    const verdict = worstLevel(rec.results.filter((r) => r.slots.includes(slot)));
    const call = calls.get(slot);
    const by = !rec.autoPicked.includes(slot) ? "you" : rec.startedWith.includes(slot) ? "starting pick" : "score";
    const edge = (c: NonNullable<typeof call>) =>
      c.decidedBy === "accounts" ? "shares an account" : c.decidedBy === "fewer_problems" ? "fewer warnings" : c.decidedBy === "perks" ? `pairs well: ${c.perk}` : c.decidedBy === "checks" ? "fits the rest better" : criterionLabel(c.decidedBy as Parameters<typeof criterionLabel>[0], slot);
    const alt = !call ? "" : call.decidedBy === "starting_pick" ? ` (${call.runnerUp.name} scores higher)` : call.decidedBy === "tie" ? ` (ties ${call.runnerUp.name})` : ` (beats ${call.runnerUp.name}: ${edge(call)})`;
    const note = plan.notes[slot]?.text;
    lines.push(
      `- ${slot}: ${option.id} [${verdict}] ${by}: ${pickReason(index, input, rec.results, slot, option)}${alt}${costOf.has(slot) ? ` | ${costOf.get(slot)}` : ""}${option.coverage === "full" ? "" : isOwn(option.id) ? " | built by the person, never checked" : " | not fully researched"}${note ? ` | note: ${clip(note, 120)}` : ""}`,
    );
  }
  const custom = Object.entries(plan.custom ?? {});
  if (custom.length) {
    lines.push("Added by hand (no facts, never checked or priced):");
    for (const [id, part] of custom) lines.push(`- ${id}: ${part.name}${part.role ? `, the app ${part.role} it` : ""}${part.env.length ? ` | env ${part.env.join(", ")}` : ""}${part.note ? ` | note: ${clip(part.note, 120)}` : ""}`);
  }
  const problems = [...rec.results].filter((r) => r.level !== "info").sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  if (problems.length) {
    lines.push("Problems:");
    for (const r of problems) lines.push(`- ${r.level} ${r.slots.join("+")}: ${r.title}.${r.fix ? ` Fix: ${clip(r.fix, 160)}` : ""}`);
  }
  const matters = questionsThatMatter(index, input, plan.pinned, 3);
  if (matters.length) lines.push(`Answers that would change the plan: ${matters.join(", ")}.`);
  lines.push("Facts are sourced drafts; get_option <id> has values and source URLs. update_plan to change anything.");
  return lines.join("\n");
}
