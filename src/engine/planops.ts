import { z } from "zod";
import { costBySize, costOutlook, describeTotal } from "./cost";
import { optionIn, worstLevel, type CatalogIndex, type CheckResult, type Level } from "./evaluate";
import { questionsThatMatter } from "./followups";
import { closeCalls, criterionLabel, recommend, type Recommendation } from "./score";
import { PRIORITY_IDS, SIZE_IDS, SLOT_IDS, type Answer, type PlanInput, type Selection, type SlotId } from "./schema";
import { CUSTOM_ID, NOTE_MAX, customPartSchema, oneLine, sharedPlanSchema, type SharedPlan } from "./share";
import { isOwn } from "./own";
import { pickReason } from "./spec";
import { planStats } from "./stats";
import { connectionsOf } from "./wiring";
import { SIZE_PHRASE, inSentence } from "./text";
import { endOption, EXTRA_ID, extraSlot, LINK_KINDS, LINK_WORDS, linkEnd, linkId, linkVerdict } from "./extras";

/**
 * Plans as something another program can read and change: what the MCP server gives Claude.
 * Every change goes through the same validation as the planner, and every report comes from the
 * same verdicts, costs and scores, so Claude can only ask StackWise, never overrule it.
 */

const ANSWER_WORDS: Record<Answer, string> = { yes: "yes", no: "no", not_sure: "not sure" };
const LEVEL_ORDER: Record<Level, number> = { blocked: 0, missing: 1, warning: 2, unknown: 3, info: 4 };

/** Changing a custom part: only the fields given change. A new one needs a name. */
const customPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.string().max(80).optional(),
  url: z.string().max(300).optional(),
  env: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(120)).max(20).optional(),
  note: z.string().max(NOTE_MAX).optional(),
});

/** The closest ids to a mistyped one, for "Did you mean": same text inside, or two letters off at most. */
export function nearest(input: string, ids: string[], max = 3): string[] {
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length];
  };
  const needle = input.toLowerCase();
  return ids
    .map((id) => ({ id, score: id.includes(needle) || needle.includes(id) ? 0 : distance(needle, id) }))
    .filter((c) => c.score <= 2)
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, max)
    .map((c) => c.id);
}

/** One line to draw (or, with remove, to take away) between two things in the plan. */
const linkUpdateSchema = z.object({
  from: z.string().max(80).describe('"app", a part id, an extra id like "database.cache", or a custom part id.'),
  to: z.string().max(80),
  kind: z.enum(LINK_KINDS).default("calls"),
  what: oneLine(120).optional().describe("What travels, in a few words."),
  remove: z.boolean().optional(),
});

export const planUpdateSchema = z.object({
  app_name: oneLine(200).optional(),
  description: z.string().max(5000).optional(),
  features: z.string().max(5000).optional(),
  answers: z.record(z.string(), z.enum(["yes", "no", "not_sure"])).optional(),
  /** An option id puts it in the part; "" keeps the part empty; null lets StackWise pick again. */
  parts: z.partialRecord(z.enum(SLOT_IDS), z.string().max(80).nullable()).optional(),
  size: z.enum(SIZE_IDS).optional(),
  priority: z.enum(PRIORITY_IDS).optional(),
  builder: z.string().regex(/^[a-z0-9-]*$/).max(40).optional(),
  /** Notes by part id. Text replaces the note; "" removes it. */
  /** Keyed by part id; checked in applyPlanUpdate so a wrong key gets a useful answer. */
  notes: z.record(z.string().max(80), z.string().max(NOTE_MAX)).optional(),
  /** Parts StackWise doesn't list, by id ("custom-<name>"): fields to set (the rest stay as they are), or null to remove it. Never checked or priced. */
  custom: z
    .record(z.string().regex(CUSTOM_ID, "Custom part ids look like custom-redis: custom- then lowercase letters, digits and dashes."), customPatchSchema.nullable())
    .optional(),
  /** A second (third…) service in a part, by "<part>.<name>": option id and what it's for, or null to remove it. Checked and priced like the rest. */
  extras: z
    .record(
      z.string().regex(EXTRA_ID, "Extra ids look like database.cache: the part id, a dot, then a short name."),
      z.object({ option: z.string().max(80), role: oneLine(40).optional(), note: z.string().max(NOTE_MAX).optional() }).nullable(),
    )
    .optional(),
  /** Lines between two things: the app, parts, extras, custom parts. */
  links: z.array(linkUpdateSchema).max(20).optional(),
});
export type PlanUpdate = z.infer<typeof planUpdateSchema>;

export class PlanUpdateError extends Error {}

export function planInput(plan: SharedPlan): PlanInput {
  return { answers: plan.answers, size: plan.size, priority: plan.priority, ...(plan.extras && Object.keys(plan.extras).length ? { extras: plan.extras } : {}) };
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
      problems.push(`There's no question "${needId}". Question ids: ${index.catalog.needs.map((n) => n.id).join(", ")}.`);
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
        if (value.startsWith("own-") && slot === "framework") {
          problems.push("The framework is the app itself, so it can't be your own code. Pick a framework.");
          continue;
        }
        const guesses = nearest(value, [...index.optionsById.keys()]);
        problems.push(`There's no option "${value}".${guesses.length ? ` Did you mean ${guesses.map((g) => `"${g}"`).join(" or ")}?` : ""} search_options lists option ids; "own-${slot}" means the person builds it.`);
        continue;
      }
      if (!option.slots.includes(slot)) {
        // Same company, right part: supabase-auth for login, supabase-db for the database.
        const sibling = index.catalog.options.find((o) => o.provider === option.provider && o.slots.includes(slot));
        problems.push(`${option.name} goes in ${option.slots.map((s) => partLabel(s)).join(" or ")}, not ${partLabel(slot)}.${sibling ? ` For ${partLabel(slot)}, use "${sibling.id}".` : ""}`);
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
    if (!(SLOT_IDS as readonly string[]).includes(slot)) {
      problems.push(
        (slot as string).startsWith("custom-")
          ? `A note on ${slot} goes in custom: {"${slot}": {"note": "..."}}.`
          : `There's no part "${slot}". Part ids: ${SLOT_IDS.join(", ")}.`,
      );
      continue;
    }
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

  for (const [id, patch] of Object.entries(update.custom ?? {})) {
    const current = plan.custom?.[id];
    if (patch === null) {
      if (!current) continue;
      delete next.custom![id];
      changes.push(`Removed ${current.name}, added by hand`);
      continue;
    }
    const given = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    if (!current && !given.name) {
      problems.push(`${id} is new, so it needs a name.`);
      continue;
    }
    const part = customPartSchema.parse({ ...current, ...given });
    const changed = (["name", "role", "url", "env", "note"] as const).filter((field) => JSON.stringify(current?.[field]) !== JSON.stringify(part[field]));
    if (current && changed.length === 0) continue;
    next.custom = { ...next.custom, [id]: part };
    changes.push(current ? `Updated ${part.name}: ${changed.join(", ")}` : `Added ${part.name} as a part StackWise doesn't check`);
  }

  for (const [id, value] of Object.entries(update.extras ?? {})) {
    const slot = extraSlot(id);
    const current = plan.extras?.[id];
    if (!slot) {
      problems.push(`There's no part "${id.split(".")[0]}". Part ids: ${SLOT_IDS.join(", ")}.`);
      continue;
    }
    if (value === null) {
      if (!current) continue;
      delete next.extras![id];
      next.links = Object.fromEntries(Object.entries(next.links ?? {}).filter(([, link]) => link.from !== id && link.to !== id));
      changes.push(`Removed ${index.optionsById.get(current.option)?.name ?? current.option} (${current.role || id}) from ${partLabel(slot)}`);
      continue;
    }
    if (slot === "framework") {
      problems.push("An app has one framework, so it can't have an extra one.");
      continue;
    }
    const option = index.optionsById.get(value.option);
    if (!option || !option.slots.includes(slot)) {
      const guesses = nearest(value.option, index.catalog.options.filter((o) => o.slots.includes(slot)).map((o) => o.id));
      problems.push(`"${value.option}" isn't a ${partLabel(slot)} option.${guesses.length ? ` Did you mean ${guesses.map((g) => `"${g}"`).join(" or ")}?` : ""}`);
      continue;
    }
    const extra = { slot, option: option.id, role: value.role ?? current?.role ?? id.split(".")[1], ...(value.note ?? current?.note ? { note: value.note ?? current?.note } : {}) };
    if (JSON.stringify(current) === JSON.stringify(extra)) continue;
    next.extras = { ...next.extras, [id]: extra };
    changes.push(current ? `Changed ${id} to ${option.name} (${extra.role})` : `Added ${option.name} to ${partLabel(slot)} as ${extra.role}`);
  }

  // Links go after parts and extras, so a line can point at something added in the same update.
  const nextInput = planInput(next);
  const nextSelection = update.links?.length ? recommend(index, nextInput, next.pinned).selection : {};
  const endName = (end: string) => (end === "app" ? "the app" : endOption(index, end, nextSelection, nextInput)?.name ?? next.custom?.[end]?.name ?? end);
  for (const link of update.links ?? []) {
    const id = linkId(link.from, link.to);
    if (link.remove) {
      if (!next.links?.[id]) continue;
      delete next.links[id];
      changes.push(`Removed the line from ${endName(link.from)} to ${endName(link.to)}`);
      continue;
    }
    const missing = [link.from, link.to].filter((end) => !linkEnd(end, nextSelection, nextInput, next.custom ?? {}).exists);
    if (missing.length) {
      problems.push(`${missing.map((end) => `"${end}"`).join(" and ")} ${missing.length === 1 ? "isn't" : "aren't"} in the plan. A line joins "app", a filled part id, an extra id like "database.cache", or a custom part id.`);
      continue;
    }
    if (link.from === link.to) {
      problems.push("A line needs two different ends.");
      continue;
    }
    const drawn = { from: link.from, to: link.to, kind: link.kind, ...(link.what ? { what: link.what } : {}) };
    if (JSON.stringify(next.links?.[id]) === JSON.stringify(drawn)) continue;
    next.links = { ...next.links, [id]: drawn };
    changes.push(`${endName(link.from)} ${LINK_WORDS[link.kind]} ${endName(link.to)}${link.what ? `: ${link.what}` : ""}`);
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
      ...(r.instance ? { extra: r.instance } : {}),
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
      lines: [...outlook.now.lines.map((l) => `${l.instance ?? l.slot} (${l.option.name}): ${l.headline}`), ...outlook.now.fees.map((f) => `${f.slot} (${f.label}): $${f.usd} ${f.per === "year" ? "a year" : "once"}`)],
    };
  }
  return {
    ...total,
    lines: [
      ...outlook.now.lines.map((l) => ({ part: l.instance ?? l.slot, option: l.option.name, cost: l.headline, ...(l.detail ? { detail: l.detail } : {}) })),
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
    stack: stackReport(index, rec.selection).map((part) => ({ ...part, picked_by: rec.autoPicked.includes(part.part) ? "stackwise" : "you" })),
    // Parts added by hand: StackWise has no facts on them, so they're listed, never checked or priced.
    ...(Object.keys(plan.custom ?? {}).length
      ? { custom_parts: Object.entries(plan.custom ?? {}).map(([id, part]) => ({ id, name: part.name, ...(part.role ? { role: part.role } : {}), ...(part.env.length ? { env: part.env } : {}), ...(full && part.url ? { url: part.url } : {}), ...(full && part.note ? { note: part.note } : {}) })) }
      : {}),
    ...(Object.keys(plan.extras ?? {}).length
      ? {
          extras: Object.entries(plan.extras ?? {}).map(([id, extra]) => ({
            id,
            option_id: extra.option,
            option: index.optionsById.get(extra.option)?.name ?? extra.option,
            role: extra.role,
            verdict: worstLevel(rec.results.filter((r) => r.instance === id)),
            ...(extra.note ? { note: extra.note } : {}),
          })),
        }
      : {}),
    ...(Object.keys(plan.links ?? {}).length
      ? {
          links: Object.values(plan.links ?? {}).map((link) => {
            const verdict = linkVerdict(index, rec.results, link, rec.selection, input);
            return { from: link.from, to: link.to, kind: link.kind, ...(link.what ? { what: link.what } : {}), verdict: verdict.checked ? verdict.level : "not checked" };
          }),
        }
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
    connections: connectionsOf(index, rec.selection, input.extras).map((c) => ({ part: c.instance ?? c.slot, option: c.optionName, what_travels: c.what, environment_variables: c.env.map((v) => v.name) })),
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
    ...changedKeys(before.plan.extras, after.plan.extras, "extras_changed"),
    ...changedKeys(before.plan.links, after.plan.links, "links_changed"),
  };
}

/** Which ids were added, changed or removed between two records, for the diff. */
function changedKeys<T>(before: Record<string, T> | undefined, after: Record<string, T> | undefined, name: string) {
  const ids = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((id) => JSON.stringify(before?.[id]) !== JSON.stringify(after?.[id]));
  return ids.length ? { [name]: ids.map((id) => ({ id, change: !before?.[id] ? "added" : !after?.[id] ? "removed" : "changed" })) } : {};
}

/**
 * The plan as a coding agent should hold it: the diagram (the app in the middle with a line to
 * each part and extra, lines people drew between things, and relationships the rules found) and
 * the reasoning behind every pick, in a few hundred tokens of plain text. Everything in it comes
 * from the rules and facts; an agent that needs a value's source calls get_option.
 */
export function planDigest(index: CatalogIndex, plan: SharedPlan, rec: Recommendation = recommend(index, planInput(plan), plan.pinned)): string {
  const input = planInput(plan);
  const label = (slot: SlotId) => index.slotsById.get(slot)?.label ?? slot;
  const clip = (text: string, max: number) => {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
  };
  const outlook = costOutlook(index, rec.selection, input);
  const costOf = new Map(outlook.now.lines.map((l) => [l.instance ?? l.slot, l.headline]));
  const calls = new Map(closeCalls(index, input, rec).map((c) => [c.slot, c]));
  const framework = optionIn(index, rec.selection, "framework");
  const own = rec.results.filter((r) => !r.instance);
  const unchecked = [
    ...SLOT_IDS.filter((slot) => isOwn(rec.selection[slot])),
    ...Object.keys(plan.custom ?? {}),
  ];

  const lines = [
    `${plan.appName || "Untitled app"}: ${framework?.name ?? "no framework yet"}, for ${SIZE_PHRASE[plan.size]}, priority ${plan.priority}. Verdict: ${worstLevel(rec.results)}${unchecked.length ? ` (not checked: ${unchecked.join(", ")})` : ""}. ${describeTotal(outlook.now)}.`,
    "Diagram: the app in the middle with a line to each part and extra (the app uses it), plus the lines under Lines.",
    "Parts (part: option [verdict] picked by: why | cost | note):",
  ];
  for (const slot of SLOT_IDS) {
    const option = optionIn(index, rec.selection, slot);
    const note = plan.notes[slot]?.text;
    if (!option) {
      const needed = rec.needed.includes(slot) && plan.pinned[slot] !== "";
      // A note on an empty part still says what the person wants there.
      if (needed || note) lines.push(`- ${slot}: EMPTY${needed ? `, the answers need ${inSentence(label(slot))}` : ""}${note ? ` | note: ${clip(note, 120)}` : ""}`);
      continue;
    }
    const verdict = worstLevel(own.filter((r) => r.slots.includes(slot)));
    const call = calls.get(slot);
    const by = !rec.autoPicked.includes(slot) ? "you" : rec.startedWith.includes(slot) ? "starting pick" : "score";
    const edge = (c: NonNullable<typeof call>) =>
      c.decidedBy === "accounts" ? "shares an account" : c.decidedBy === "fewer_problems" ? "fewer warnings" : c.decidedBy === "perks" ? `pairs well: ${c.perk}` : c.decidedBy === "checks" ? "fits the rest better" : criterionLabel(c.decidedBy as Parameters<typeof criterionLabel>[0], slot);
    const alt = !call ? "" : call.decidedBy === "starting_pick" ? ` (${call.runnerUp.name} scores higher)` : call.decidedBy === "tie" ? ` (ties ${call.runnerUp.name})` : ` (beats ${call.runnerUp.name}: ${edge(call)})`;
    lines.push(
      `- ${slot}: ${option.id} [${verdict}] ${by}: ${pickReason(index, input, own, slot, option)}${alt}${costOf.has(slot) ? ` | ${costOf.get(slot)}` : ""}${option.coverage === "full" ? "" : isOwn(option.id) ? " | built by the person, never checked" : " | not fully researched"}${note ? ` | note: ${clip(note, 120)}` : ""}`,
    );
    for (const [id, extra] of Object.entries(plan.extras ?? {}).filter(([, e]) => e.slot === slot)) {
      const extraOption = index.optionsById.get(extra.option);
      lines.push(`  - ${id}: ${extra.option} [${worstLevel(rec.results.filter((r) => r.instance === id))}] you, for ${extra.role || id}${extraOption && costOf.has(id) ? ` | ${costOf.get(id)}` : ""}${extra.note ? ` | note: ${clip(extra.note, 100)}` : ""}`);
    }
  }
  const custom = Object.entries(plan.custom ?? {});
  if (custom.length) {
    lines.push("Added by hand (no facts, never checked or priced):");
    for (const [id, part] of custom) lines.push(`- ${id}: ${part.name}${part.role ? `, the app ${part.role} it` : ""}${part.env.length ? ` | env ${part.env.join(", ")}` : ""}${part.note ? ` | note: ${clip(part.note, 120)}` : ""}`);
  }

  // What travels on each line from the app, then the lines people drew, then pairs the rules know about.
  lines.push("Lines (from -> to: what travels):");
  for (const connection of connectionsOf(index, rec.selection, input.extras)) {
    const names = connection.everything ? "every variable in the plan" : connection.env.map((v) => v.name).join(", ");
    lines.push(`- app -> ${connection.instance ?? connection.slot} (${connection.label}): ${names || "no variables listed"}`);
  }
  for (const link of Object.values(plan.links ?? {})) {
    const verdict = linkVerdict(index, rec.results, link, rec.selection, input);
    lines.push(`- ${link.from} -> ${link.to} (${LINK_WORDS[link.kind]}${link.what ? `: ${link.what}` : ""}) [${verdict.checked ? verdict.level : "not checked"}]`);
  }
  const between = rec.results.filter((r) => r.slots.length === 2 && !r.slots.includes("framework") && r.level === "info");
  if (between.length) {
    lines.push("Between parts (from the rules):");
    for (const r of between) lines.push(`- ${r.slots.join("+")}${r.instance ? ` (${r.instance})` : ""}: ${r.title}`);
  }

  const problems = [...rec.results].filter((r) => r.level !== "info").sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  if (problems.length) {
    lines.push("Problems:");
    for (const r of problems) lines.push(`- ${r.level} ${r.instance ?? r.slots.join("+")}: ${r.title}.${r.fix ? ` Fix: ${clip(r.fix, 160)}` : ""}`);
  }
  const matters = questionsThatMatter(index, input, plan.pinned, 3);
  if (matters.length) lines.push(`Answers that would change the plan: ${matters.join(", ")}.`);
  lines.push("Facts are sourced drafts; get_option <id> has values and source URLs. update_plan changes parts, extras (\"database.cache\") and lines.");
  return lines.join("\n");
}
