import { costLine } from "./cost";
import { optionIn, worstLevel, type CatalogIndex, type Level } from "./evaluate";
import { planInput } from "./planops";
import { alternativesFor, recommend } from "./score";
import type { SlotId } from "./schema";
import type { SharedPlan } from "./share";
import { formatFactValue, inSentence, possessive } from "./text";
import { connectionsOf } from "./wiring";

/**
 * Talking a part of the stack through. Everything a conversation may rely on is gathered here from
 * the engine: the connection and its variables, setup steps, checks, cost, facts with sources, the
 * alternatives with the verdict each would get, and the person's note. Claude answers from this
 * brief and nothing else, and without Claude StackWise answers from it directly.
 */

export type BriefVerdict = Level | "works";

const VERDICT_WORDS: Record<BriefVerdict, string> = {
  works: "works",
  info: "works, with a note",
  warning: "works with a warning",
  unknown: "not verified yet",
  missing: "missing a piece",
  blocked: "doesn't work",
};

export interface TalkBrief {
  app: { name: string; description: string };
  part: { id: SlotId; label: string; verb: string; what: string };
  option: { id: string; name: string; summary: string; website: string; researched: boolean } | null;
  connection: { what: string; carries_every_variable: boolean; variables: { name: string; from: string; where_to_get_it: string; docs?: string; browser_can_read_it: boolean }[] } | null;
  setup_steps: { step: string; variables: string[]; docs?: string }[];
  rules_for_builders: string[];
  checks: { verdict: string; title: string; explanation: string; fix?: string }[];
  cost: { headline: string; detail?: string; source?: string } | null;
  facts: { fact: string; value: string; note: string; source: string; checked_on: string }[];
  alternatives: { id: string; name: string; verdict: string; score_change: number; cost: string; researched: boolean }[];
  note: { text: string; written_by: "you" | "claude"; written_for?: string; may_be_out_of_date: boolean } | null;
  /** The rest of the plan, so a question can be answered in context: every part and what fills it. */
  stack: { part: string; option: string | null; verdict: string }[];
  /** Everything the rules flag anywhere in the plan, by title, worst first. */
  plan_problems: { verdict: string; title: string; parts: string[] }[];
}

const SEVERITY = ["blocked", "missing", "warning", "unknown"] as const;

/** How many other options a brief carries. The best ones come first. */
const ALTERNATIVES = 6;

export function talkBrief(index: CatalogIndex, plan: SharedPlan, slot: SlotId): TalkBrief {
  const input = planInput(plan);
  const rec = recommend(index, input, plan.pinned);
  const def = index.slotsById.get(slot)!;
  const option = optionIn(index, rec.selection, slot);
  const connection = slot === "framework" ? undefined : connectionsOf(index, rec.selection).find((c) => c.slot === slot);
  const all = connection?.everything ? connectionsOf(index, rec.selection).flatMap((c) => c.env) : [];
  const variables = connection ? (connection.everything ? [...all, ...connection.env].filter((v, i, list) => list.findIndex((w) => w.name === v.name) === i) : connection.env) : [];
  const note = plan.notes[slot];
  const writtenFor = note?.optionId && note.optionId !== option?.id ? index.optionsById.get(note.optionId)?.name ?? note.optionId : undefined;

  return {
    app: { name: plan.appName.trim() || "the app", description: plan.description.trim() },
    part: { id: slot, label: def.label, verb: def.verb, what: index.catalog.learn.slots[slot]?.what ?? def.empty_hint },
    option: option ? { id: option.id, name: option.name, summary: option.summary, website: option.website, researched: option.coverage === "full" } : null,
    connection: connection
      ? {
          what: connection.what,
          carries_every_variable: connection.everything,
          variables: variables.map((v) => ({ name: v.name, from: v.optionName, where_to_get_it: v.step, ...(v.source ? { docs: v.source } : {}), browser_can_read_it: v.browser })),
        }
      : null,
    setup_steps: option ? option.setup.map((s) => ({ step: s.step, variables: s.env, ...(/^https?:\/\//.test(s.source) ? { docs: s.source } : {}) })) : [],
    stack: index.catalog.slots
      .filter((s) => rec.selection[s.id] || rec.needed.includes(s.id))
      .map((s) => {
        const picked = optionIn(index, rec.selection, s.id);
        const touching = rec.results.filter((r) => r.slots.includes(s.id) && r.level !== "info");
        return { part: s.label, option: picked?.name ?? null, verdict: VERDICT_WORDS[picked ? worstLevel(touching) : "missing"] };
      }),
    plan_problems: rec.results
      .filter((r) => (SEVERITY as readonly string[]).includes(r.level))
      .sort((a, b) => SEVERITY.indexOf(a.level as (typeof SEVERITY)[number]) - SEVERITY.indexOf(b.level as (typeof SEVERITY)[number]))
      .map((r) => ({ verdict: VERDICT_WORDS[r.level], title: r.title, parts: r.slots.map((id) => index.slotsById.get(id)?.label ?? id) })),
    rules_for_builders: option ? [...option.builder_notes, ...rec.results.filter((r) => r.builder && r.slots.includes(slot)).map((r) => r.builder!)] : [],
    checks: rec.results
      .filter((r) => r.slots.includes(slot))
      .map((r) => ({ verdict: VERDICT_WORDS[r.level], title: r.title, explanation: r.explanation, ...(r.fix ? { fix: r.fix } : {}) })),
    cost: option
      ? (({ headline, detail, source }) => ({ headline, ...(detail ? { detail } : {}), ...(source ? { source } : {}) }))(costLine(index, option, slot, input))
      : null,
    facts: option
      ? Object.entries(option.facts).map(([key, fact]) => ({
          fact: index.catalog.facts[key]?.label ?? key,
          value: formatFactValue(index, index.catalog.facts[key], fact.value),
          note: fact.note,
          source: fact.source,
          checked_on: fact.retrieved,
        }))
      : [],
    alternatives: alternativesFor(index, input, rec.selection, slot)
      .filter((a) => a.option.id !== option?.id)
      .slice(0, ALTERNATIVES)
      .map((a) => ({
        id: a.option.id,
        name: a.option.name,
        verdict: VERDICT_WORDS[a.worst],
        score_change: Number(a.delta.toFixed(2)),
        cost: costLine(index, a.option, slot, input).headline,
        researched: a.option.coverage === "full",
      })),
    note: note ? { text: note.text, written_by: note.by, ...(writtenFor ? { written_for: writtenFor } : {}), may_be_out_of_date: Boolean(writtenFor) } : null,
  };
}

/** An alternative Claude may suggest: StackWise's rules must not find a problem with it. */
export function swappable(brief: TalkBrief): TalkBrief["alternatives"] {
  return brief.alternatives.filter((a) => a.verdict === VERDICT_WORDS.works || a.verdict === VERDICT_WORDS.info);
}

/**
 * A starting note from the facts alone: what the connection needs, the setup in order, and what to
 * watch. It's a draft for the person to edit, never a verdict.
 */
export function draftNote(brief: TalkBrief): string {
  if (!brief.option) return `Nothing is in ${inSentence(brief.part.label)} yet. Pick an option first, then write down how it should work.`;
  const lines: string[] = [];
  const vars = brief.connection?.variables ?? [];
  if (brief.connection?.carries_every_variable && vars.length) lines.push(`Add every variable to ${possessive(brief.option.name)} settings before deploying: ${vars.map((v) => v.name).join(", ")}.`);
  else if (vars.length) {
    const secretsOnly = !vars.some((v) => v.browser_can_read_it);
    const browser = secretsOnly ? (vars.length === 1 ? " It must never reach the browser." : " None of them may reach the browser.") : " Only the public ones may reach the browser.";
    lines.push(`Reads ${vars.map((v) => v.name).join(", ")}.${browser}`);
  }
  if (brief.setup_steps.length) {
    lines.push("", "Setup:");
    brief.setup_steps.forEach((s, i) => lines.push(`${i + 1}. ${s.step}`));
  }
  const watch = [...brief.checks.filter((c) => c.verdict !== VERDICT_WORDS.works && c.verdict !== VERDICT_WORDS.info).map((c) => `${c.title}.${c.fix ? ` ${c.fix}` : ""}`), ...brief.rules_for_builders.slice(0, 3)];
  if (watch.length) {
    lines.push("", "Watch for:");
    for (const item of [...new Set(watch)]) lines.push(`- ${item}`);
  }
  return lines.join("\n").trim() || `${brief.option.name}: no setup steps or rules are recorded yet. Follow its quickstart at ${brief.option.website}.`;
}

export interface FactsAnswer {
  reply: string;
  proposal?: { text: string; summary: string };
  swap?: string;
}

const INTENTS: { id: "note" | "keys" | "setup" | "cost" | "swap" | "problems" | "what"; words: RegExp }[] = [
  { id: "note", words: /\b(note|draft|write (it|that|this) down|summari[sz]e)\b/i },
  { id: "keys", words: /\b(keys?|env|environment|variables?|secrets?|tokens?|credentials?|api key)\b/i },
  { id: "swap", words: /\b(instead|alternatives?|switch|swap|replace|other options?|something else|better option|compare)\b/i },
  { id: "cost", words: /\b(costs?|price|pricing|pay|free|cheap(er)?|expensive|bill|budget)\b|\$/i },
  { id: "problems", words: /\b(problems?|wrong|risks?|watch|issues?|break|warnings?|gotchas?|careful|fail)\b/i },
  { id: "setup", words: /\b(set ?up|install|connect|wire|configure|start|steps?|how do i|how to)\b/i },
  { id: "what", words: /\b(what is|what's|explain|why)\b/i },
];

/**
 * Answers without Claude, from the brief alone. It recognizes the common questions (setup, keys,
 * cost, problems, alternatives, a note) and says what it knows; it never guesses beyond the brief.
 */
export function answerFromFacts(brief: TalkBrief, question: string): FactsAnswer {
  const name = brief.option?.name;
  if (!name) return { reply: `Nothing is in ${inSentence(brief.part.label)} yet. Drag an option onto it, or use "Pick one for me", and then ask again.` };
  const intent = INTENTS.find((i) => i.words.test(question))?.id;
  const vars = brief.connection?.variables ?? [];

  switch (intent) {
    case "note":
      return { reply: `Here's a starting note from what StackWise knows about ${name}. Edit it to add what you decided.`, proposal: { text: draftNote(brief), summary: "A starting note from the facts" } };
    case "keys":
      if (!vars.length) return { reply: brief.setup_steps.length ? `No environment variable is written down for ${name}. Read its setup steps before you build: it may still need one.` : `Nobody has researched ${possessive(name)} setup yet, so StackWise can't say which variables it needs.` };
      return {
        reply: [
          `${brief.connection!.carries_every_variable ? `${name} needs every variable in the plan` : `Your code reads ${vars.length === 1 ? "one variable" : `${vars.length} variables`} to reach ${name}`}:`,
          ...vars.map((v) => `- ${v.name}: ${v.where_to_get_it}${v.browser_can_read_it ? " The browser can read this one, so it must never be a secret." : ""}`),
          "Put the values in .env.local, never in the code.",
        ].join("\n"),
      };
    case "setup":
      if (!brief.setup_steps.length) return { reply: `Nobody has researched ${possessive(name)} setup yet. Follow its quickstart at ${brief.option!.website}.` };
      return { reply: [`Setting up ${name}, in order:`, ...brief.setup_steps.map((s, i) => `${i + 1}. ${s.step}${s.variables.length ? ` (${s.variables.join(", ")})` : ""}`)].join("\n") };
    case "cost": {
      if (!brief.cost) return { reply: `StackWise doesn't have a price for ${name}.` };
      const cheaper = brief.alternatives.filter((a) => a.researched).slice(0, 3);
      return {
        reply: [`${name}: ${brief.cost.headline}.${brief.cost.detail ? ` ${brief.cost.detail}` : ""}`, ...(cheaper.length ? ["", "Others for this part, with your plan:", ...cheaper.map((a) => `- ${a.name}: ${a.cost} (${a.verdict})`)] : [])].join("\n"),
      };
    }
    case "swap": {
      const options = brief.alternatives.slice(0, 4);
      if (!options.length) return { reply: `StackWise has no other options for ${inSentence(brief.part.label)}.` };
      const best = swappable(brief).find((a) => a.score_change > 0 && a.researched);
      return {
        reply: [
          `What else could fill ${inSentence(brief.part.label)}, checked against the rest of your plan:`,
          ...options.map((a) => `- ${a.name}: ${a.verdict}, ${a.cost}, ${a.score_change === 0 ? "scores the same" : `scores ${Math.abs(a.score_change)} ${a.score_change > 0 ? "higher" : "lower"}`} for your priority`),
          best ? `${best.name} scores higher for your priority.` : `${name} still scores best for your priority.`,
        ].join("\n"),
        ...(best ? { swap: best.id } : {}),
      };
    }
    case "problems": {
      const serious = brief.checks.filter((c) => c.verdict !== VERDICT_WORDS.works && c.verdict !== VERDICT_WORDS.info);
      const lines = serious.length ? serious.map((c) => `- ${c.title}. ${c.fix ?? c.explanation}`) : [`- No rule found a problem with ${name} in your plan.`];
      return { reply: [`What to watch with ${name}:`, ...lines, ...brief.rules_for_builders.slice(0, 3).map((r) => `- ${r}`)].join("\n") };
    }
    case "what":
      return { reply: `${brief.part.what} ${name}: ${brief.option!.summary}` };
    default:
      return {
        reply: `Your app ${brief.part.verb} ${name}. ${brief.option!.summary} Claude isn't on, so StackWise answers from its own facts: ask about setup, keys, cost, problems or alternatives, or ask for a note.`,
      };
  }
}
