import { BUILD_ORDER, adaptEnvName } from "./checklist";
import { costBySize, costOutlook, describeTotal, money } from "./cost";
import { buildDecisionRecord } from "./decisions";
import { evaluatePlan, needIsOn, optionIn, type CatalogIndex, type CheckResult } from "./evaluate";
import { CRITERIA, criterionLabel, criterionScores } from "./score";
import type { Answer, PlanInput, Selection } from "./schema";
import type { SharedPlan } from "./share";
import { SIZE_PHRASE } from "./text";
import { envFileText, planEnv } from "./wiring";

/**
 * The spec pack: what the beginner walks away with. SPEC.md explains the plan, SETUP.md is the
 * ordered checklist of accounts and keys, and a third file is shaped for the builder they use.
 * Every warning becomes a rule the builder is told to follow.
 */

export interface SpecDetails {
  appName: string;
  description: string;
  features: string;
  builderId: string;
  generatedOn: string;
  /** The person's notes on each part. Left out, a pack has none. */
  notes?: SharedPlan["notes"];
}

export interface SpecFile {
  name: string;
  content: string;
}

const PROBLEM_LEVELS = new Set(["blocked", "missing", "warning", "unknown"]);

/** Keeps the values out of git from the first commit, whichever framework the plan uses. */
const GITIGNORE = [
  "# Secrets. Never commit these.",
  ".env",
  ".env.local",
  ".env.*.local",
  "",
  "# Installed packages and build output",
  "node_modules/",
  ".next/",
  ".svelte-kit/",
  ".vercel/",
  "dist/",
  "build/",
  "",
  "# Editors and computers",
  ".DS_Store",
  "*.log",
  "",
].join("\n");

function unique(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}

function answerLabel(answer: Answer | undefined): string {
  if (answer === "yes") return "yes";
  if (answer === "no") return "no";
  if (answer === "not_sure") return "not sure, planned as no";
  return "not asked, planned as no";
}

function resultLine(r: CheckResult): string {
  const sources = r.sources?.length ? ` Sources: ${r.sources.join(", ")}` : "";
  return `- **${r.title}.** ${r.explanation}${r.fix ? ` Fix: ${r.fix}` : ""}${sources}`;
}

export function buildSpecPack(index: CatalogIndex, input: PlanInput, selection: Selection, details: SpecDetails): SpecFile[] {
  const { catalog } = index;
  const results = evaluatePlan(index, selection, input);
  const name = details.appName.trim() || "My app";
  const builder = catalog.planning.builders.find((b) => b.id === details.builderId) ?? catalog.planning.builders[catalog.planning.builders.length - 1];

  const filled = BUILD_ORDER.flatMap((slot) => {
    const option = optionIn(index, selection, slot);
    const def = index.slotsById.get(slot);
    return option && def ? [{ slot, option, def }] : [];
  });

  const stackRows = filled.map(({ slot, option, def }) => {
    const scores = criterionScores(index, option, slot, input);
    // Payments and AI are paid per use, so "free at your size" and plan prices don't describe them.
    // A payment service's price score compares its fee per sale, so that one stays.
    const perUse = slot === "payments" || slot === "ai";
    const noMonthlyFee = option.facts.first_paid_usd_month?.value === null && option.coverage === "full";
    const strengths = CRITERIA.filter((c) => scores[c] >= 0.75)
      .filter((c) => !(perUse && (c === "cost" || (c === "price" && slot === "ai"))))
      .map((c) => (c === "price" && noMonthlyFee && slot !== "domain" ? "no monthly fee" : criterionLabel(c, slot)));
    if (perUse && noMonthlyFee) strengths.unshift("no monthly fee, pay per use");
    const perks = results.filter((r) => r.source === "product" && r.level === "info" && r.slots.includes(slot)).map((r) => r.title.toLowerCase());
    const why = unique([...strengths, ...perks]).join("; ") || option.summary;
    return { def, option, why };
  });

  const features = details.features
    .split("\n")
    .map((f) => f.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const featureLines = features.length ? features.map((f) => `- ${f}`) : ["- (No features listed yet. Add them in the planner before you build.)"];

  const needLines = catalog.needs
    .filter((n) => !n.only_if || needIsOn(index, input, n.only_if))
    .map((n) => `- ${n.label}: ${answerLabel(input.answers[n.id])}`);

  const rules = unique([
    "Keep every secret in environment variables. Never commit them, and never send them to the browser.",
    ...filled.flatMap(({ option }) => option.builder_notes),
    ...results.filter((r) => r.builder).map((r) => r.builder!),
  ]);

  const problems = results.filter((r) => PROBLEM_LEVELS.has(r.level));
  const notes = results.filter((r) => r.level === "info");
  const tasks = filled.map(({ def, option }, i) => `${i + 1}. ${def.build_task.replace("{option}", option.name)}`);

  const outlook = costOutlook(index, selection, input);
  const costLines = [
    ...outlook.now.lines.map((l) => {
      const label = index.slotsById.get(l.slot)?.label ?? l.slot;
      return `- **${label}, ${l.option.name}:** ${l.headline}.${l.detail ? ` ${l.detail}` : ""}`;
    }),
    ...outlook.now.fees.map((f) => `- **${f.label}:** $${f.usd} ${f.per === "year" ? "a year" : "one time"}. Source: ${f.source}`),
  ];

  const env = planEnv(index, selection);
  const envNames = unique(env.map((v) => v.name));
  const stackList = filled.map(({ def, option }) => `- ${def.label}: ${option.name}`);

  // The person's notes, kept word for word. A note written for another option says so.
  const personNotes = filled.flatMap(({ slot, def, option }) => {
    const note = details.notes?.[slot];
    if (!note?.text.trim()) return [];
    const writtenFor = note.optionId && note.optionId !== option.id ? index.optionsById.get(note.optionId)?.name ?? note.optionId : undefined;
    return [{ heading: `${def.label}: ${option.name}`, text: note.text.trim(), writtenFor }];
  });
  const noteBlocks = personNotes.flatMap((n) => [`### ${n.heading}`, "", ...(n.writtenFor ? [`_Written when this part was ${n.writtenFor}. Check that it still applies._`, ""] : []), n.text, ""]);
  const noteBullets = personNotes.map((n) => `- ${n.heading}${n.writtenFor ? ` (written for ${n.writtenFor})` : ""}: ${n.text.replace(/\s*\n\s*/g, " ")}`);

  const spec = [
    `# ${name}: build spec`,
    "",
    `> Planned with WhyStack on ${details.generatedOn}. The facts behind these choices are drafts until reviewed, so check the linked sources before relying on a price or limit.`,
    "",
    "## What the app does",
    "",
    details.description.trim() || "(No description yet.)",
    "",
    "## Features",
    "",
    ...featureLines,
    "",
    "## What it needs",
    "",
    ...needLines,
    "",
    "## Stack",
    "",
    "| Part | Choice | Why |",
    "|---|---|---|",
    ...stackRows.map(({ def, option, why }) => `| ${def.label} | ${option.name} | ${why} |`),
    "",
    ...(noteBlocks.length ? ["## Notes on the stack", "", "Written by the person planning the app. Follow them unless they contradict a rule below.", "", ...noteBlocks] : []),
    "## Rules for whoever builds it",
    "",
    ...rules.map((r) => `- ${r}`),
    "",
    "## Problems to watch",
    "",
    ...(problems.length ? problems.map(resultLine) : ["- None found for this plan."]),
    "",
    "## Good to know",
    "",
    ...(notes.length ? notes.map(resultLine) : ["- Nothing extra."]),
    "",
    "## Cost",
    "",
    ...costLines,
    "",
    `For ${SIZE_PHRASE[outlook.now.size]}: ${describeTotal(outlook.now)}.`,
    ...(outlook.next ? ["", `For ${SIZE_PHRASE[outlook.next.size]}: ${describeTotal(outlook.next)}.`] : []),
    "",
    "| Monthly users | Estimated monthly cost |",
    "|---|---|",
    ...costBySize(index, selection, input).map((s) => `| ${catalog.planning.sizes.find((z) => z.id === s.size)?.label ?? s.size} | ${describeTotal(s, { monthlyOnly: true })} |`),
    ...(outlook.now.yearlyUsd > 0 || outlook.now.oneTimeUsd > 0
      ? ["", `At every size, also ${[outlook.now.yearlyUsd > 0 && `${money(outlook.now.yearlyUsd)} a year`, outlook.now.oneTimeUsd > 0 && `${money(outlook.now.oneTimeUsd)} once`].filter(Boolean).join(" and ")}.`]
      : []),
    "",
    "## Build order",
    "",
    ...tasks,
    "",
  ].join("\n");

  const setupSections = filled.flatMap(({ def, option }, i) => {
    const steps = option.setup.map((s) => {
      const names = s.env.length ? ` Environment variables: ${s.env.map((e) => `\`${adaptEnvName(e, selection.framework)}\``).join(", ")}.` : "";
      const source = /^https?:\/\//.test(s.source) ? ` ([docs](${s.source}))` : "";
      return `- [ ] ${s.step}${names}${source}`;
    });
    return [`## ${i + 1}. ${option.name} (${def.label})`, "", ...(steps.length ? steps : ["- [ ] Setup steps not researched yet. Follow the provider's quickstart."]), ""];
  });

  const setup = [
    `# Setup checklist for ${name}`,
    "",
    "Do these in order. Put secret values in `.env.local` or your host's environment settings, never in the code.",
    "",
    ...setupSections,
    "## Environment variables",
    "",
    "Copy `.env.example` to `.env.local` and fill in the values. `.env.local` never goes into git.",
    "",
    "```",
    ...(envNames.length ? envNames.map((e) => `${e}=`) : ["# none needed yet"]),
    "```",
    "",
  ].join("\n");

  const agentGuide = [
    `# ${name}`,
    "",
    "This project was planned with WhyStack. SPEC.md is the source of truth for the stack and the rules, and SETUP.md lists the accounts and environment variables.",
    "",
    "## Stack",
    "",
    ...stackList,
    "",
    ...(noteBullets.length ? ["## Notes on the stack", "", ...noteBullets, ""] : []),
    "## Rules",
    "",
    ...rules.map((r) => `- ${r}`),
    "",
    "## Build order",
    "",
    ...tasks,
    "",
    "## Environment variables",
    "",
    "`.env.example` has every name, grouped by service, with the step that gives you each value. Values live in `.env.local`, which must never be committed.",
    "",
    ...(envNames.length ? env.map((v) => `- \`${v.name}\` (${v.optionName}${v.browser ? ", reaches the browser, so never a secret" : ""})`) : ["- None yet."]),
    "",
  ].join("\n");

  const prompt = [
    `Build a web app called ${name}.`,
    "",
    details.description.trim(),
    "",
    "Features:",
    ...featureLines,
    "",
    "Use exactly this stack:",
    ...stackList,
    "",
    ...(noteBullets.length ? ["Notes on the stack:", ...noteBullets, ""] : []),
    "Follow these rules:",
    ...rules.map((r) => `- ${r}`),
    ...(problems.length ? ["", "Watch out for:", ...problems.map((p) => `- ${p.title}.${p.fix ? ` ${p.fix}` : ""}`)] : []),
    "",
    "Build in this order:",
    ...tasks,
    "",
  ].join("\n");

  const builderFile: SpecFile =
    builder.format === "claude-md"
      ? { name: "CLAUDE.md", content: agentGuide }
      : builder.format === "agents-md"
        ? { name: "AGENTS.md", content: agentGuide }
        : { name: "PROMPT.txt", content: prompt };

  const decisions = buildDecisionRecord(index, input, selection, { appName: name, generatedOn: details.generatedOn });

  return [
    { name: "SPEC.md", content: spec },
    { name: "SETUP.md", content: setup },
    { name: ".env.example", content: envFileText(env, { appName: name, generatedOn: details.generatedOn }) },
    { name: ".gitignore", content: GITIGNORE },
    builderFile,
    { name: "DECISIONS.md", content: decisions },
  ];
}
