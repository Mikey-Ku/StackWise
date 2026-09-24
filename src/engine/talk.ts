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

/** The same words the page uses for each verdict (VERDICT_UI in ui.tsx), in lowercase for a sentence. */
export const VERDICT_WORDS: Record<BriefVerdict, string> = {
  works: "works",
  info: "works, with a note",
  warning: "works, with a warning",
  unknown: "not verified yet",
  missing: "missing a service",
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
  alternatives: { id: string; name: string; verdict: string; score_change: number; cost: string; researched: boolean; problems: string[] }[];
  /** Options the question named for this part, by id. Each is in alternatives. */
  asked_about?: string[];
  note: { text: string; written_by: "you" | "claude"; written_for?: string; may_be_out_of_date: boolean } | null;
  /** The rest of the plan, so a question can be answered in context: every part and what fills it. */
  stack: { part: string; option: string | null; verdict: string }[];
  /** Everything the rules flag anywhere in the plan, by title, worst first. */
  plan_problems: { verdict: string; title: string; parts: string[] }[];
}

const SEVERITY = ["blocked", "missing", "warning", "unknown"] as const;

/** How many other options a brief carries. The best ones come first. */
const ALTERNATIVES = 6;

/**
 * Which part a question is about, and which options it names for that part. "Can I use Supabase
 * instead of Firebase for the database?" asked while the app is selected is about the database.
 * A question that names the part already selected, or its option, stays there; otherwise the first
 * part it names wins, then the part of the first option it names, preferring parts in the plan.
 */
export function questionFocus(index: CatalogIndex, plan: SharedPlan, slot: SlotId, question: string): { slot: SlotId; mentioned: string[] } {
  const rec = recommend(index, planInput(plan), plan.pinned);
  const at = (term: string, caseSensitive = false): number => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(^|[^\\w])${escaped}(?=$|[^\\w])`, caseSensitive ? "" : "i").exec(question);
    return match ? match.index + match[1].length : -1;
  };
  const partAt = (id: SlotId) => Math.min(...[index.slotsById.get(id)?.label ?? id, ...(PART_WORDS[id] ?? [])].map((t) => at(t)).map((i) => (i < 0 ? Infinity : i)));
  const optionAt = (id: string) => {
    const option = index.optionsById.get(id);
    if (!option || option.provider === "you") return Infinity;
    return Math.min(...optionAliases(option.name).map((alias) => (COMMON_WORDS.has(alias.toLowerCase()) ? at(alias, true) : at(alias))).map((i) => (i <= 0 && COMMON_WORDS.has(option.name.toLowerCase()) ? Infinity : i < 0 ? Infinity : i)));
  };
  const named = index.catalog.options.map((o) => ({ option: o, at: optionAt(o.id) })).filter((n) => Number.isFinite(n.at)).sort((a, b) => a.at - b.at);
  const current = rec.selection[slot];
  const inPlan = (id: SlotId) => Boolean(rec.selection[id]) || rec.needed.includes(id);

  let focus = slot;
  const currentNamed = Number.isFinite(partAt(slot)) || (current !== undefined && named.some((n) => n.option.id === current));
  if (!currentNamed) {
    const parts = index.catalog.slots.map((s) => ({ id: s.id, at: partAt(s.id) })).filter((p) => Number.isFinite(p.at)).sort((a, b) => a.at - b.at);
    if (parts.length) focus = parts[0].id;
    else {
      const slots = named.flatMap((n) => n.option.slots);
      focus = slots.find(inPlan) ?? slots[0] ?? slot;
    }
  }
  const mentioned = named.filter((n) => n.option.slots.includes(focus) && n.option.id !== rec.selection[focus]).map((n) => n.option.id);
  return { slot: focus, mentioned: [...new Set(mentioned)] };
}

/** Other ways people name a part, beyond its label. */
const PART_WORDS: Partial<Record<SlotId, string[]>> = {
  framework: ["framework"],
  hosting: ["host", "hosting", "deploy"],
  domain: ["domain"],
  database: ["database", "db"],
  login: ["login", "log in", "sign in", "sign-in", "auth", "authentication"],
  files: ["file storage", "storage", "uploads"],
  payments: ["payment", "payments", "checkout"],
  scraping: ["scraping", "scraper"],
  jobs: ["background job", "background jobs", "queue", "cron"],
  email: ["email", "emails"],
  analytics: ["analytics"],
  monitoring: ["error monitoring", "monitoring", "error alerts"],
  mobile: ["phone app", "mobile app", "ios", "android"],
  automations: ["automation", "automations"],
  data_apis: ["outside data"],
};

/** Option names that are everyday words: only a capitalized mention past the first word counts. */
const COMMON_WORDS = new Set(["make", "render", "resend", "temporal", "convex", "polar", "railway", "neon", "expo", "groq", "turso"]);

/** "Firestore (Firebase)" is named as Firestore, Firebase or the whole thing. */
function optionAliases(name: string): string[] {
  const aside = name.match(/\(([^)]+)\)/)?.[1];
  const bare = name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  return [...new Set([name, bare, ...(aside && !/unofficial|react native|swift/i.test(aside) ? [aside] : [])])].filter((alias) => alias.length >= 3);
}

export function talkBrief(index: CatalogIndex, plan: SharedPlan, slot: SlotId, mentioned: string[] = []): TalkBrief {
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
    alternatives: (() => {
      const all = alternativesFor(index, input, rec.selection, slot).filter((a) => a.option.id !== option?.id);
      // The best few, plus any option the question named.
      return [...all.slice(0, ALTERNATIVES), ...all.slice(ALTERNATIVES).filter((a) => mentioned.includes(a.option.id))];
    })()
      .map((a) => ({
        id: a.option.id,
        name: a.option.name,
        verdict: VERDICT_WORDS[a.worst],
        score_change: Number(a.delta.toFixed(2)),
        cost: costLine(index, a.option, slot, input).headline,
        researched: a.option.coverage === "full",
        problems: a.results.filter((r) => r.level !== "info").map((r) => r.title),
      })),
    ...(mentioned.some((id) => id !== option?.id) ? { asked_about: mentioned.filter((id) => id !== option?.id) } : {}),
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
  if (!name) return { reply: `Nothing is picked for ${inSentence(brief.part.label)} yet. Pick a service for it in Parts, then ask again.` };
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
      const asked = (brief.asked_about ?? []).flatMap((id) => brief.alternatives.filter((a) => a.id === id));
      const others = brief.alternatives.filter((a) => !asked.includes(a)).slice(0, asked.length ? 3 : 4);
      if (!asked.length && !others.length) return { reply: `StackWise has no other options for ${inSentence(brief.part.label)}.` };
      const rank = (a: TalkBrief["alternatives"][number]) => (a.score_change === 0 ? "Ranks the same" : a.score_change > 0 ? "Ranks higher" : "Ranks lower");
      const line = (a: TalkBrief["alternatives"][number]) => `- ${a.name}: ${a.verdict}${a.problems.length ? ` (${a.problems.join("; ")})` : ""}. ${a.cost}. ${rank(a)} for your priority.`;
      const fits = swappable(brief).filter((a) => a.researched);
      const pick = asked.find((a) => fits.includes(a)) ?? fits.find((a) => a.score_change > 0);
      return {
        reply: [
          ...(asked.length
            ? [`${asked.map((a) => a.name).join(" or ")} instead of ${name}, checked against the rest of your plan:`, ...asked.map(line), ...(others.length ? ["", "Other options:"] : [])]
            : [`What else could fill ${inSentence(brief.part.label)}, checked against the rest of your plan:`]),
          ...others.map(line),
          pick ? (asked.includes(pick) ? `${pick.name} works with the rest of your plan.` : `${pick.name} ranks higher for your priority.`) : `${name} still ranks best for your priority.`,
        ].join("\n"),
        ...(pick ? { swap: pick.id } : {}),
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
        reply: `Your app ${brief.part.verb} ${name}. ${brief.option!.summary} This answer comes from StackWise's facts: ask about setup, keys, cost, problems or alternatives, or ask for a note.`,
      };
  }
}
