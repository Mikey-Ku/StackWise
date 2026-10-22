import { type CatalogIndex, type CheckResult, type Level, optionIn, worstLevel } from "./evaluate";
import { planDiff, planInput } from "./planops";
import type { Answer, SlotId } from "./schema";
import { closeCalls, criterionLabel, type CloseCall, type Recommendation } from "./score";
import type { SharedPlan } from "./share";
import { pickReason } from "./spec";
import { inSentence, SIZE_PHRASE } from "./text";

/**
 * The chat narrates the plan. Every change a person makes on the canvas (or an answer they give,
 * or a change an agent made over MCP) becomes two turns in the conversation: what changed, as if
 * they'd typed it, and what it did, from the rules and facts alone: which parts changed and why
 * they were picked, the checks that appeared or went away, the cost before and after. No AI is
 * involved, so it's instant and works with nothing connected; a question about it can follow.
 *
 * Pure: two moments of the plan in, a narration out, or null when nothing worth saying changed.
 */

export interface PlanMoment {
  plan: SharedPlan;
  rec: Recommendation;
}

export interface Narration {
  /** What changed, in the person's voice: "Answered yes: Will people pay you inside the app?" */
  you: string;
  /** What it did, from the facts. */
  facts: string;
  /** The part the turns are about: the first part that changed, else the app. */
  about: SlotId;
}

const ANSWER_WORD: Record<Answer, string> = { yes: "yes", no: "no", not_sure: "not sure" };
const PROBLEM_LEVELS: Level[] = ["blocked", "missing", "warning", "unknown"];
const MAX_CHECKS = 4;

function edge(index: CatalogIndex, call: CloseCall): string {
  if (call.decidedBy === "accounts") return "shares an account";
  if (call.decidedBy === "fewer_problems") return "fewer warnings";
  if (call.decidedBy === "perks") return `pairs well: ${call.perk}`;
  if (call.decidedBy === "checks") return "fits the rest better";
  if (call.decidedBy === "tie" || call.decidedBy === "starting_pick") return "";
  return criterionLabel(call.decidedBy, call.slot);
}

/** Ids added, changed or removed between two records. */
function changedIds<T>(before: Record<string, T> | undefined, after: Record<string, T> | undefined): [string, "added" | "removed" | "changed"][] {
  const ids = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return ids.filter((id) => JSON.stringify(before?.[id]) !== JSON.stringify(after?.[id])).map((id) => [id, !before?.[id] ? "added" : !after?.[id] ? "removed" : "changed"]);
}

const sentence = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat ? (/[.!?]$/.test(flat) ? flat : `${flat}.`) : "";
};

export function narrateChange(index: CatalogIndex, before: PlanMoment, after: PlanMoment): Narration | null {
  const you: string[] = [];
  const label = (slot: SlotId) => index.slotsById.get(slot)?.label ?? slot;

  // What the person did: answers, size, priority, and the parts they set or cleared themselves.
  const needIds = [...new Set([...Object.keys(before.plan.answers), ...Object.keys(after.plan.answers)])];
  const touchedSlots: SlotId[] = [];
  const answered: Record<string, string[]> = {};
  for (const id of needIds) {
    const was = before.plan.answers[id];
    const now = after.plan.answers[id];
    if (was === now) continue;
    const need = index.needsById.get(id);
    const key = now ? ANSWER_WORD[now] : "cleared";
    (answered[key] ??= []).push(need?.question ?? id);
    for (const slot of need?.adds_slots ?? []) touchedSlots.push(slot);
  }
  // Several answers at once (a starting point, a confirm step) read as one line per answer.
  for (const [word, questions] of Object.entries(answered)) you.push(word === "cleared" ? `Cleared the answer to: ${questions.join(" ")}` : `Answered ${word}: ${questions.join(" ")}`);
  if (before.plan.size !== after.plan.size) you.push(`Planned for ${SIZE_PHRASE[after.plan.size]}.`);
  if (before.plan.priority !== after.plan.priority) {
    const priority = index.catalog.planning.priorities.find((p) => p.id === after.plan.priority);
    you.push(`Priority: ${priority?.label ?? after.plan.priority}.`);
  }

  const diff = planDiff(index, before, after);
  const parts = diff.parts_changed ?? [];
  const pinnedSlots: SlotId[] = [];
  for (const p of parts) {
    const pinnedBefore = before.plan.pinned[p.part];
    const pinnedAfter = after.plan.pinned[p.part];
    if (pinnedBefore === pinnedAfter) continue;
    pinnedSlots.push(p.part);
    if (pinnedAfter === "") you.push(`Cleared ${inSentence(label(p.part))}.`);
    else if (pinnedAfter) you.push(`${label(p.part)}: ${p.to ?? "nothing"}.`);
    else you.push(`Let StackWise pick ${inSentence(label(p.part))}.`);
  }
  for (const [id, change] of changedIds(before.plan.extras, after.plan.extras)) you.push(`${change === "added" ? "Added" : change === "removed" ? "Removed" : "Changed"} the extra service ${id}.`);
  for (const [id, change] of changedIds(before.plan.links, after.plan.links)) you.push(`${change === "added" ? "Drew" : change === "removed" ? "Removed" : "Changed"} the line ${id}.`);

  if (you.length === 0 && parts.length === 0) return null;
  if (you.length === 0) you.push(parts.map((p) => `${label(p.part)}: ${p.from ?? "nothing"} to ${p.to ?? "nothing"}`).join(". ") + ".");

  // What it did.
  const facts: string[] = [];
  const input = planInput(after.plan);
  const own = after.rec.results.filter((r) => !r.instance);
  const calls = new Map(closeCalls(index, input, after.rec).map((c) => [c.slot, c]));
  for (const p of parts.slice(0, 4)) {
    const option = optionIn(index, after.rec.selection, p.part);
    const head = `${label(p.part)}: ${p.from ?? "nothing"} to ${p.to ?? "nothing"}.`;
    if (!option) {
      facts.push(`${head}${after.rec.needed.includes(p.part) ? ` The answers still need ${inSentence(label(p.part))}: pick one in Parts.` : ""}`);
      continue;
    }
    const verdict = worstLevel(own.filter((r) => r.slots.includes(p.part)));
    const pinned = Boolean(after.plan.pinned[p.part]);
    const call = calls.get(p.part);
    const beat = call && call.runnerUp && edge(index, call) ? ` It beat ${call.runnerUp.name}: ${edge(index, call)}.` : "";
    const why = pinned ? "Your pick." : `StackWise picked it: ${sentence(pickReason(index, input, own, p.part, option))}${beat}`;
    facts.push(`${head} ${sentence(option.summary)} ${why} Verdict for this part: ${verdict}.`);
  }

  const beforeKeys = new Set(before.rec.results.map((r) => r.key));
  const afterKeys = new Set(after.rec.results.map((r) => r.key));
  const fresh = after.rec.results.filter((r) => !beforeKeys.has(r.key));
  const problems = fresh.filter((r) => PROBLEM_LEVELS.includes(r.level));
  const notes = fresh.filter((r) => r.level === "info");
  const gone = before.rec.results.filter((r) => !afterKeys.has(r.key) && PROBLEM_LEVELS.includes(r.level));
  const line = (r: CheckResult) => `- ${r.title}: ${sentence(r.explanation)}${r.fix ? ` Fix: ${sentence(r.fix)}` : ""}`;
  if (problems.length) facts.push(`New to watch:\n${problems.slice(0, MAX_CHECKS).map(line).join("\n")}${problems.length > MAX_CHECKS ? `\n- and ${problems.length - MAX_CHECKS} more in Overview` : ""}`);
  if (notes.length) facts.push(`Good to know:\n${notes.slice(0, 2).map(line).join("\n")}`);
  if (gone.length) facts.push(`Resolved: ${gone.map((r) => r.title).join("; ")}.`);
  if (diff.verdict.includes("->")) facts.push(`Plan verdict: ${diff.verdict.replace("->", "to")}.`);
  facts.push(typeof diff.cost === "string" ? `Cost: ${diff.cost}, unchanged.` : `Cost: ${diff.cost.after} (was ${diff.cost.before}).`);
  if ((diff.notes_to_review ?? []).length) facts.push(`Your note on ${diff.notes_to_review!.map((s) => inSentence(label(s))).join(" and ")} was written for the old pick: worth a look.`);

  // About the part the person set, else the part an answer brought in, else the first part that changed, else the app.
  const about = pinnedSlots[0] ?? touchedSlots.find((slot) => parts.some((p) => p.part === slot)) ?? parts[0]?.part ?? touchedSlots.find((slot) => after.rec.selection[slot] || after.rec.needed.includes(slot)) ?? "framework";
  return { you: you.join(" "), facts: facts.join("\n\n"), about };
}
