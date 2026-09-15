import { BUILD_ORDER, adaptEnvName } from "./checklist";
import { costBySize, costOutlook, describeTotal } from "./cost";
import { buildDecisionRecord } from "./decisions";
import { evaluatePlan, needIsOn, optionIn, type CatalogIndex, type CheckResult } from "./evaluate";
import { CRITERIA, CRITERION_LABELS, criterionScores } from "./score";
import type { Answer, PlanInput, Selection } from "./schema";

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
}

export interface SpecFile {
  name: string;
  content: string;
}

const PROBLEM_LEVELS = new Set(["blocked", "missing", "warning", "unknown"]);

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
    const perUse = slot === "payments" || slot === "ai";
    const noMonthlyFee = option.facts.first_paid_usd_month?.value === null && option.coverage === "full";
    const strengths = CRITERIA.filter((c) => scores[c] >= 0.75)
      .filter((c) => !(perUse && (c === "cost" || c === "price")))
      .map((c) => (c === "price" && noMonthlyFee ? "no monthly fee" : CRITERION_LABELS[c]));
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
  const sizeLabel = (id: string) => catalog.planning.sizes.find((s) => s.id === id)?.label.toLowerCase() ?? id;
  const costLines = outlook.now.lines.map((l) => {
    const label = index.slotsById.get(l.slot)?.label ?? l.slot;
    return `- **${label}, ${l.option.name}:** ${l.headline}.${l.detail ? ` ${l.detail}` : ""}`;
  });

  const envNames = unique(filled.flatMap(({ option }) => option.setup.flatMap((s) => s.env.map((e) => adaptEnvName(e, selection.framework)))));
  const stackList = filled.map(({ def, option }) => `- ${def.label}: ${option.name}`);

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
    `At ${sizeLabel(outlook.now.size)} people: ${describeTotal(outlook.now)}.`,
    ...(outlook.next ? ["", `At ${sizeLabel(outlook.next.size)} people: ${describeTotal(outlook.next)}.`] : []),
    "",
    "| Monthly users | Estimated monthly cost |",
    "|---|---|",
    ...costBySize(index, selection, input).map((s) => `| ${catalog.planning.sizes.find((z) => z.id === s.size)?.label ?? s.size} | ${describeTotal(s)} |`),
    "",
    "## Build order",
    "",
    ...tasks,
    "",
  ].join("\n");

  const setupSections = filled.flatMap(({ def, option }, i) => {
    const steps = option.setup.map((s) => {
      const env = s.env.length ? ` Environment variables: ${s.env.map((e) => `\`${adaptEnvName(e, selection.framework)}\``).join(", ")}.` : "";
      const source = /^https?:\/\//.test(s.source) ? ` ([docs](${s.source}))` : "";
      return `- [ ] ${s.step}${env}${source}`;
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
    "Names only. Fill in the values yourself.",
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
    "Names only. Values live in `.env.local`, which must never be committed.",
    "",
    ...(envNames.length ? envNames.map((e) => `- \`${e}\``) : ["- None yet."]),
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
    builderFile,
    { name: "DECISIONS.md", content: decisions },
  ];
}
