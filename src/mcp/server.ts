import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  adaptEnvName,
  alternativesFor,
  applyPlanUpdate,
  buildChecklist,
  buildProjectPack,
  checkReport,
  costReport,
  evaluatePlan,
  formatFactValue,
  optionStats,
  planInput,
  planReport,
  PlanUpdateError,
  planUpdateSchema,
  PRIORITY_IDS,
  recommend,
  SIZE_IDS,
  SLOT_IDS,
  stackReport,
  worstLevel,
  type CatalogIndex,
  type Selection,
  type SlotId,
} from "@/engine";
import type { PlanRecord, Registry } from "./registry";

/**
 * WhyStack's MCP server. Every tool calls the same engine the planner uses, so Claude asks
 * WhyStack whether services work together instead of deciding from memory. The plan tools read
 * and change the plan the person shared from WhyStack (or an exported project's plan file), and
 * every change and result is logged where the WhyStack tab shows it.
 */

export interface McpContext {
  /** A fresh catalog, so edits to /data show up without restarting. */
  index: () => CatalogIndex;
  registry: Registry;
  /** The plan the plan tools use when no plan_id is given. */
  planId: () => string | null;
  /** Runs after Claude saves a plan, for example to update a project's whystack.plan.json. */
  afterSave?: (record: PlanRecord) => void;
  /** Where WhyStack lives, for the .mcp.json an exported project uses. */
  whystackRoot: string;
  where: "app" | "project";
}

export const SERVER_INSTRUCTIONS =
  "WhyStack plans web app stacks for beginners and decides whether services work together from sourced facts and rules. " +
  "Don't decide compatibility, prices or limits from memory: call check_stack, compare_options or estimate_costs, and pass on the reasons and sources. " +
  "get_plan and update_plan work on the plan the person shared from WhyStack, or this project's whystack.plan.json. Changes show up in WhyStack right away, so give every update a short note saying why.";

const stackSchema = z
  .partialRecord(z.enum(SLOT_IDS), z.string().max(80))
  .describe('Part ids mapped to option ids, like { "hosting": "vercel", "database": "neon" }. list_parts and search_options give the ids.');
const answersSchema = z
  .record(z.string(), z.enum(["yes", "no", "not_sure"]))
  .describe('Question ids mapped to answers, like { "login": "yes", "users_pay": "no" }. get_plan lists every question id.');
const sizeSchema = z.enum(SIZE_IDS).describe("Monthly users in the first months: just_me, up_to_100, up_to_1000 or more.");
const prioritySchema = z.enum(PRIORITY_IDS).describe("What matters most: spend_zero, launch_fast, learn or ready_to_grow.");
const planIdSchema = z.string().max(64).optional().describe("Leave out to use the plan shared from WhyStack.");

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const json = (data: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (message: string): Result => ({ content: [{ type: "text", text: message }], isError: true });

function checkStackIds(index: CatalogIndex, stack: Selection): string[] {
  return Object.entries(stack).flatMap(([slot, id]) => {
    if (!id) return [];
    const option = index.optionsById.get(id);
    if (!option) return [`There's no option "${id}". Use search_options to find ids.`];
    if (!option.slots.includes(slot as SlotId)) return [`${option.name} can't fill ${slot}; it fits ${option.slots.join(" or ")}.`];
    return [];
  });
}

export function createWhyStackServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: "whystack", version: "0.3.0" }, { instructions: SERVER_INSTRUCTIONS });

  const sharedPlan = (planId: string | undefined): PlanRecord | string => {
    const id = planId ?? ctx.planId();
    if (!id) {
      return ctx.where === "app"
        ? "No plan is shared yet. In WhyStack (http://localhost:4310), open the plan and turn on Pair with Claude."
        : "This project has no whystack.plan.json. Export the project from WhyStack to create one.";
    }
    return ctx.registry.read(id) ?? `There's no shared plan "${id}". Turn on Pair with Claude in WhyStack for that plan.`;
  };

  /** Show a tool's result in WhyStack, on the plan being worked on, if there is one. */
  const log = (tool: string, summary: string, verdict?: string) => {
    const id = ctx.planId();
    if (id) ctx.registry.addActivity(id, { tool, summary, changes: [], ...(verdict ? { verdict } : {}) });
  };

  const names = (index: CatalogIndex, stack: Selection) =>
    stackReport(index, stack)
      .map((p) => p.option)
      .join(" + ");

  server.registerTool(
    "list_parts",
    {
      title: "List the parts of an app",
      description: "Every part of a web app WhyStack plans (hosting, database, login, payments, scraping and more): what each is for, which question ids add it, and how many options it has.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const index = ctx.index();
      return json(
        index.catalog.slots.map((slot) => ({
          id: slot.id,
          label: slot.label,
          what: index.catalog.learn.slots[slot.id]?.what ?? slot.empty_hint,
          added_by_questions: index.catalog.needs.filter((n) => n.adds_slots.includes(slot.id)).map((n) => n.id),
          options: index.catalog.options.filter((o) => o.slots.includes(slot.id)).length,
        })),
      );
    },
  );

  server.registerTool(
    "search_options",
    {
      title: "Search options",
      description: "Find services and frameworks by part or by words in their name or summary. Returns ids, whether they're fully researched, and quick stats like cost at the given size.",
      inputSchema: {
        part: z.enum(SLOT_IDS).optional().describe("Only options for this part."),
        query: z.string().max(100).optional().describe("Words to match in the name or summary."),
        size: sizeSchema.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ part, query, size }) => {
      const index = ctx.index();
      const q = query?.trim().toLowerCase();
      const input = { answers: {}, size: size ?? "up_to_100", priority: "spend_zero" as const };
      const found = index.catalog.options
        .filter((o) => (!part || o.slots.includes(part)) && (!q || `${o.name} ${o.summary} ${o.provider} ${o.id}`.toLowerCase().includes(q)))
        .slice(0, 40)
        .map((o) => ({
          id: o.id,
          name: o.name,
          parts: o.slots,
          summary: o.summary,
          researched: o.coverage === "full",
          stats: Object.fromEntries((part ? [part] : o.slots).map((slot) => [slot, optionStats(index, o, slot, input).map((s) => `${s.label}: ${s.value}`)])),
        }));
      return found.length ? json(found) : fail("No options matched. Try a part id from list_parts, or fewer words.");
    },
  );

  server.registerTool(
    "get_option",
    {
      title: "Get an option's facts",
      description: "Everything WhyStack knows about one option: each fact with its plain-language note, source link and the date it was checked, plus setup steps with exact environment variable names and rules for whoever builds with it.",
      inputSchema: { option_id: z.string().max(80) },
      annotations: { readOnlyHint: true },
    },
    async ({ option_id }) => {
      const index = ctx.index();
      const option = index.optionsById.get(option_id);
      if (!option) return fail(`There's no option "${option_id}". Use search_options to find ids.`);
      return json({
        id: option.id,
        name: option.name,
        parts: option.slots,
        summary: option.summary,
        website: option.website,
        researched: option.coverage === "full",
        facts: Object.entries(option.facts).map(([key, fact]) => ({
          fact: index.catalog.facts[key]?.label ?? key,
          value: formatFactValue(index, index.catalog.facts[key], fact.value),
          note: fact.note,
          source: fact.source,
          checked_on: fact.retrieved,
          reviewed_by_a_person: fact.status === "verified",
        })),
        setup: option.setup.map((s) => ({ step: s.step, environment_variables: s.env, docs: s.source })),
        rules_for_builders: option.builder_notes,
      });
    },
  );

  server.registerTool(
    "check_stack",
    {
      title: "Check a stack",
      description: "Run WhyStack's rules on a set of choices and get every verdict (doesn't work, missing a piece, warning, not verified, good to know) with its reason, fix and sources, plus the cost. Use this before recommending or adding any service.",
      inputSchema: { stack: stackSchema, answers: answersSchema.optional(), size: sizeSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ stack, answers, size }) => {
      const index = ctx.index();
      const problems = checkStackIds(index, stack);
      if (problems.length) return fail(problems.join(" "));
      const input = { answers: answers ?? {}, size: size ?? "up_to_100", priority: "spend_zero" as const };
      const results = evaluatePlan(index, stack, input);
      const verdict = worstLevel(results);
      log("check_stack", `Checked ${names(index, stack) || "an empty stack"}`, verdict);
      return json({ stack: stackReport(index, stack), verdict, checks: checkReport(index, results), cost: costReport(index, stack, input) });
    },
  );

  server.registerTool(
    "recommend_stack",
    {
      title: "Recommend a stack",
      description: "WhyStack's best stack for a set of answers, audience size and priority, with every check, the close calls and the cost. Parts in keep stay as given.",
      inputSchema: { answers: answersSchema, size: sizeSchema.optional(), priority: prioritySchema.optional(), keep: stackSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ answers, size, priority, keep }) => {
      const index = ctx.index();
      const problems = checkStackIds(index, keep ?? {});
      if (problems.length) return fail(problems.join(" "));
      const plan = { v: 1 as const, appName: "", description: "", features: "", answers, size: size ?? "up_to_100", priority: priority ?? "spend_zero", builderId: "claude-code", pinned: keep ?? {} };
      const report = planReport(index, plan);
      log("recommend_stack", `Recommended ${report.stack.map((p) => p.option).join(" + ")}`, report.verdict);
      const { stack, verdict, checks, close_calls, cost } = report;
      return json({ stack, verdict, checks, close_calls, cost });
    },
  );

  server.registerTool(
    "compare_options",
    {
      title: "Compare options",
      description: "Compare two to five options for one part, each as if swapped into the rest of the stack: the verdict it would get, its problems, how the stack's score changes, and its stats.",
      inputSchema: {
        part: z.enum(SLOT_IDS),
        option_ids: z.array(z.string().max(80)).min(2).max(5),
        stack: stackSchema.optional(),
        answers: answersSchema.optional(),
        size: sizeSchema.optional(),
        priority: prioritySchema.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ part, option_ids, stack, answers, size, priority }) => {
      const index = ctx.index();
      const problems = [...checkStackIds(index, stack ?? {}), ...checkStackIds(index, Object.fromEntries(option_ids.map((id) => [part, id])))];
      if (problems.length) return fail(problems.join(" "));
      const input = { answers: answers ?? {}, size: size ?? "up_to_100", priority: priority ?? "spend_zero" };
      const alternatives = alternativesFor(index, input, stack ?? {}, part).filter((a) => option_ids.includes(a.option.id));
      log("compare_options", `Compared ${alternatives.map((a) => a.option.name).join(", ")} for ${index.slotsById.get(part)?.label ?? part}`);
      return json({
        part,
        options: alternatives.map((a) => ({
          id: a.option.id,
          name: a.option.name,
          researched: a.option.coverage === "full",
          verdict_with_this_stack: a.worst,
          problems: a.results.filter((r) => r.level !== "info").map((r) => `${r.title}. ${r.fix ?? r.explanation}`),
          score_change: Number(a.delta.toFixed(2)),
          stats: optionStats(index, a.option, part, input).map((s) => `${s.label}: ${s.value}`),
        })),
      });
    },
  );

  server.registerTool(
    "estimate_costs",
    {
      title: "Estimate costs",
      description: "What a stack costs at the given audience size and at every size: monthly, yearly (domains, app store accounts) and one-time, part by part, from sourced prices.",
      inputSchema: { stack: stackSchema, size: sizeSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ stack, size }) => {
      const index = ctx.index();
      const problems = checkStackIds(index, stack);
      if (problems.length) return fail(problems.join(" "));
      const report = costReport(index, stack, { answers: {}, size: size ?? "up_to_100", priority: "spend_zero" });
      log("estimate_costs", `Estimated costs for ${names(index, stack)}: ${report.now}`);
      return json(report);
    },
  );

  server.registerTool(
    "setup_steps",
    {
      title: "Get setup steps",
      description: "The ordered setup steps (accounts, keys, exact environment variable names with docs links) and build order for a stack. Variable names follow the framework in the stack.",
      inputSchema: { stack: stackSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ stack }) => {
      const index = ctx.index();
      const problems = checkStackIds(index, stack);
      if (problems.length) return fail(problems.join(" "));
      const checklist = buildChecklist(index, stack);
      return json({
        setup: checklist.setup.map((i) => ({ part: i.slot, option: i.optionName, step: i.text, environment_variables: i.env.map((e) => adaptEnvName(e, stack.framework)), docs: i.source })),
        build_order: checklist.build.map((i) => i.text),
      });
    },
  );

  server.registerTool(
    "get_plan",
    {
      title: "Get the shared plan",
      description: "The plan the person shared from WhyStack: the app, its answers, the stack and who picked each part, every check, close calls, costs, and every question id with its answer.",
      inputSchema: { plan_id: planIdSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ plan_id }) => {
      const record = sharedPlan(plan_id);
      if (typeof record === "string") return fail(record);
      return json({ plan_id: record.id, version: record.version, last_changed_by: record.updatedBy, ...planReport(ctx.index(), record.plan) });
    },
  );

  server.registerTool(
    "update_plan",
    {
      title: "Change the shared plan",
      description:
        "Change the plan shared from WhyStack: answers, parts, audience size, priority, builder, name, description or features. The change shows up in WhyStack right away and can be undone there. Returns what changed and the plan's new checks and costs.",
      inputSchema: { plan_id: planIdSchema, note: z.string().min(3).max(300).describe("One line saying why, shown in WhyStack next to the change."), ...planUpdateSchema.shape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ plan_id, note, ...update }) => {
      const record = sharedPlan(plan_id);
      if (typeof record === "string") return fail(record);
      const index = ctx.index();
      let applied;
      try {
        applied = applyPlanUpdate(index, record.plan, update);
      } catch (error) {
        if (error instanceof PlanUpdateError) return fail(error.message);
        throw error;
      }
      if (applied.changes.length === 0) return json({ changes: [], message: "Nothing changed; the plan already matches.", plan: planReport(index, record.plan) });
      const rec = recommend(index, planInput(applied.plan), applied.plan.pinned);
      const saved = ctx.registry.savePlan(record.id, applied.plan, "claude", { tool: "update_plan", summary: note, changes: applied.changes, verdict: worstLevel(rec.results) });
      ctx.afterSave?.(saved);
      return json({ plan_id: saved.id, version: saved.version, changes: applied.changes, plan: planReport(index, saved.plan, rec) });
    },
  );

  server.registerTool(
    "export_project",
    {
      title: "Export the project files",
      description:
        "Every file for building the shared plan with an AI builder: SPEC.md, SETUP.md, TASKS.md, DECISIONS.md, whystack.plan.json and, for Claude Code, CLAUDE.md, .mcp.json, and agents and skills in .claude. Write them at the project's root.",
      inputSchema: { plan_id: planIdSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ plan_id }) => {
      const record = sharedPlan(plan_id);
      if (typeof record === "string") return fail(record);
      const index = ctx.index();
      const rec = recommend(index, planInput(record.plan), record.plan.pinned);
      const files = buildProjectPack(
        index,
        planInput(record.plan),
        rec.selection,
        {
          appName: record.plan.appName,
          description: record.plan.description,
          features: record.plan.features,
          builderId: record.plan.builderId,
          generatedOn: new Date().toISOString().slice(0, 10),
          planId: record.id,
          plan: record.plan,
        },
        { whystackRoot: ctx.whystackRoot },
      );
      log("export_project", `Exported ${files.length} project files`);
      return json({ files: files.map((f) => ({ path: f.name, content: f.content })) });
    },
  );

  return server;
}
