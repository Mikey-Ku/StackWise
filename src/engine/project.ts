import { BUILD_ORDER, adaptEnvName } from "./checklist";
import { evaluatePlan, optionIn, type CatalogIndex, type CheckResult } from "./evaluate";
import type { PlanInput, Selection, SlotId } from "./schema";
import type { SharedPlan } from "./share";
import { buildSpecPack, type SpecDetails, type SpecFile } from "./spec";
import { buildTask, isOwn } from "./own";
import { buildPlan, buildPlanMarkdown } from "./buildplan";

/**
 * The project pack: the spec pack plus what an AI builder needs to work through it on its own.
 * For Claude Code that's a plan file, the StackWise MCP server in `.mcp.json`, a task list, and
 * agents: one per part of the stack, a stack guard that checks every service change with
 * StackWise, a setup guide and a reviewer. File formats follow Claude Code's docs for subagents
 * (.claude/agents), skills (.claude/skills) and project MCP servers (.mcp.json).
 */

export interface ProjectDetails extends SpecDetails {
  planId: string;
  plan: SharedPlan;
  /**
   * The shared copy's version and time, so the plan file starts level with it. Left out, the file
   * says version 0 at midnight, and the first sync would treat it as older than StackWise's copy.
   */
  version?: number;
  updatedAt?: string;
}

export interface ProjectOptions {
  /** Where StackWise lives on this machine, so the project can start its MCP server. */
  stackwiseRoot?: string;
}

const PROBLEM_LEVELS = new Set(["blocked", "missing", "warning", "unknown"]);

/**
 * A YAML value that can't break out of its line: newlines become spaces, and anything YAML would
 * read as syntax is quoted. Agent files are read by Claude Code, and their frontmatter sets what
 * an agent is allowed to do, so text from a plan (the app's name, a custom part) must stay text.
 */
export function yamlValue(value: string): string {
  const flat = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return /^[\w(]/.test(flat) && !/: |\s#|["'`{}[\]|>&*!%@]/.test(flat) ? flat : JSON.stringify(flat);
}

function frontmatter(fields: Record<string, string>): string {
  return ["---", ...Object.entries(fields).map(([k, v]) => `${k}: ${yamlValue(v)}`), "---", ""].join("\n");
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}

function resultLine(r: CheckResult): string {
  return `- **${r.title}.** ${r.explanation}${r.fix ? ` Fix: ${r.fix}` : ""}`;
}

export function buildProjectPack(index: CatalogIndex, input: PlanInput, selection: Selection, details: ProjectDetails, options: ProjectOptions = {}): SpecFile[] {
  const spec = buildSpecPack(index, input, selection, { ...details, notes: details.notes ?? details.plan.notes, custom: details.custom ?? details.plan.custom, links: details.links ?? details.plan.links });
  const name = details.appName.trim() || "My app";
  const builder = index.catalog.planning.builders.find((b) => b.id === details.builderId);
  const results = evaluatePlan(index, selection, input);
  const problems = results.filter((r) => PROBLEM_LEVELS.has(r.level));

  const parts = BUILD_ORDER.flatMap((slot) => {
    const option = optionIn(index, selection, slot);
    const def = index.slotsById.get(slot);
    return option && def ? [{ slot, option, def, agent: `build-${slot}` }] : [];
  });

  const planFile: SpecFile = {
    name: "stackwise.plan.json",
    content: `${JSON.stringify({ stackwise: 1, id: details.planId, version: details.version ?? 0, updatedAt: details.updatedAt ?? `${details.generatedOn}T00:00:00.000Z`, plan: details.plan }, null, 2)}\n`,
  };

  const doneWhen = (slot: SlotId, inAgentFile = false) => {
    const option = optionIn(index, selection, slot)!;
    const envs = unique(option.setup.flatMap((s) => s.env.map((e) => adaptEnvName(e, selection.framework))));
    return [
      "The task above works end to end in the running app.",
      ...(envs.length ? [`Settings come from environment variables (${envs.map((e) => `\`${e}\``).join(", ")}), and no secret reaches the browser.`] : []),
      inAgentFile ? "It follows the Rules above." : `It follows the rules in \`.claude/agents/build-${slot}.md\`.`,
      "`spec-reviewer` passes.",
    ];
  };

  // TASKS.md is the canvas as work: parts, extra services, parts added by hand and the lines between them (buildplan.ts).
  const tasks: SpecFile = {
    name: "TASKS.md",
    content: buildPlanMarkdown(buildPlan(index, input, selection, details.plan), { appName: name, generatedOn: details.generatedOn, problems: problems.length > 0 }),
  };

  if (builder?.format !== "claude-md") return [...spec, tasks, planFile];

  const mcpReady = Boolean(options.stackwiseRoot);
  const stackwiseSection = [
    "## Working with StackWise",
    "",
    "`stackwise.plan.json` is the record of this stack and why each part was picked. The StackWise MCP server" +
      (mcpReady ? " (in `.mcp.json`)" : "") +
      " runs the same checks as StackWise itself, from sourced facts.",
    "",
    "- Don't decide from memory whether services work together, what they cost or what their limits are. Before adding, removing or swapping a hosted service, SDK or host, use the `stack-guard` agent, or call `check_stack` yourself.",
    "- After the stack changes, call `update_plan` with a one-line note saying why, then add the decision to DECISIONS.md.",
    "- For exact setup steps and environment variable names, call `setup_steps`.",
    ...(mcpReady ? [] : ["- The MCP server isn't connected yet. See docs/MCP.md in StackWise to add it."]),
    "",
    "## How to build",
    "",
    "Work through TASKS.md in order with `/next-step`. Each part of the stack has its own agent in `.claude/agents/`, and `spec-reviewer` checks the work before a task is checked off. `setup-guide` walks through SETUP.md; it never asks for secret values.",
    "",
  ].join("\n");

  const files: SpecFile[] = spec.map((f) => (f.name === "CLAUDE.md" ? { ...f, content: `${f.content.trimEnd()}\n\n${stackwiseSection}` } : f));

  const agent = (fileName: string, fields: Record<string, string>, body: string[]): SpecFile => ({
    name: `.claude/agents/${fileName}.md`,
    content: `${frontmatter({ name: fileName, ...fields })}${body.join("\n")}\n`,
  });

  const agents: SpecFile[] = [
    agent(
      "stack-guard",
      {
        description: "Use before adding, removing or swapping any hosted service, SDK or host, and whenever someone asks whether two services work together or what they cost. Checks the change with StackWise and records it in the plan.",
        tools: "Read, Grep, Glob, Edit, mcp__stackwise",
      },
      [
        `You keep ${name}'s stack honest. StackWise decides whether services work together, from sourced facts. You never decide that from memory.`,
        "",
        "For any proposed change:",
        "",
        "1. Call `get_plan` to see the current stack, its checks and its costs.",
        "2. To choose an option for a part, call `compare_options` with just the part: it ranks the best options within the plan. To check one change, call `check_stack` with only `swap`, like `{ \"email\": \"postmark\" }`.",
        "3. Explain the result in plain words: what works, each warning with its fix, and how the monthly cost changes.",
        "4. If the person agrees, call `update_plan` with the new part and a one-line note saying why. It returns the new checks and cost, so you don't need `get_plan` again. Then add a short entry to DECISIONS.md.",
        "",
        "Never change the stack in code until the checks pass or the person has accepted the warnings.",
      ],
    ),
    agent(
      "setup-guide",
      {
        description: "Walks the person through SETUP.md one step at a time: creating accounts, finding keys and naming environment variables. Use at the start of the project and whenever a service is added.",
        tools: "Read, Grep, Glob, Edit, mcp__stackwise",
      },
      [
        `You help set up the accounts ${name} needs, in the order SETUP.md lists them.`,
        "",
        "- Go one step at a time and wait for the person to finish each one.",
        "- Never ask for a secret value, and never write one into a file or the chat. Add variable names with empty values to `.env.example`, and tell the person to put the real values in `.env.local`, which must stay out of git.",
        "- If SETUP.md looks out of date with `stackwise.plan.json`, call `setup_steps` for the current steps and names.",
      ],
    ),
    agent(
      "spec-reviewer",
      {
        description: "Reviews finished work before a task in TASKS.md is checked off: the rules in SPEC.md, the task's Done when list, secrets handling and the plan's checks.",
        tools: "Read, Grep, Glob, Bash, mcp__stackwise",
      },
      [
        `You review changes to ${name}. Don't fix anything yourself; report what to change.`,
        "",
        "Check the current changes (`git diff` and new files) against:",
        "",
        "1. The Rules section of SPEC.md.",
        "2. The Done when list of the task in TASKS.md.",
        "3. Secrets: nothing secret committed, logged or sent to the browser.",
        "4. The stack: call `get_plan`, and flag any new service or SDK that isn't in the plan.",
        "",
        "Report each item as pass or fail, with file and line for every failure.",
      ],
    ),
    ...parts.map(({ slot, option, def, agent: agentName }) => {
      const touching = results.filter((r) => r.slots.includes(slot) && r.level !== "info");
      const notes = results.filter((r) => r.slots.includes(slot) && r.level === "info");
      const personNote = details.plan.notes[slot];
      const writtenFor = personNote?.optionId && personNote.optionId !== option.id ? index.optionsById.get(personNote.optionId)?.name ?? personNote.optionId : undefined;
      return agent(
        agentName,
        {
          description: `Builds the ${def.label.toLowerCase()} part of ${name} with ${option.name}, following SPEC.md. Use for the "${def.label}" task in TASKS.md.`,
          tools: "Read, Write, Edit, Grep, Glob, Bash, mcp__stackwise",
        },
        [
          `You build one part of ${name}: ${def.label}, with ${option.name}. ${option.summary}`,
          "",
          "## The task",
          "",
          buildTask(def, option),
          "",
          "## Setup it needs",
          "",
          ...(option.setup.length
            ? [
                ...option.setup.map((s) => {
                  const env = s.env.length ? ` Environment variables: ${s.env.map((e) => `\`${adaptEnvName(e, selection.framework)}\``).join(", ")}.` : "";
                  return `- ${s.step}${env}`;
                }),
                // The docs once, not on every step.
                ...[...new Set(option.setup.map((s) => s.source).filter((url) => /^https?:\/\//.test(url)))].map((url, i) => `${i ? "More docs" : "Docs"}: ${url}`),
              ]
            : isOwn(option.id)
              ? ["- It's the person's own code, not a service. Ask them how the app reaches it (an address, credentials) and keep those in environment variables."]
              : ["- Setup steps haven't been researched. Follow the official quickstart and call `setup_steps`."]),
          "",
          "## Rules",
          "",
          ...unique([...option.builder_notes, ...results.filter((r) => r.builder && r.slots.includes(slot)).map((r) => r.builder!)]).map((r) => `- ${r}`),
          "- Keep secrets in environment variables, never in code or the browser.",
          "",
          ...(personNote?.text.trim()
            ? [
                "## Notes from the plan",
                "",
                ...(writtenFor ? [`Written when this part was ${writtenFor}. Check that it still applies, and ask if it doesn't.`, ""] : []),
                personNote.text.trim(),
                "",
              ]
            : []),
          ...(touching.length ? ["## Problems StackWise found", "", ...touching.map(resultLine), ""] : []),
          ...(notes.length ? ["## Good to know", "", ...notes.map(resultLine), ""] : []),
          "## Done when",
          "",
          ...doneWhen(slot, true).map((line) => `- ${line}`),
          "",
          "If this part needs a service or SDK that isn't in `stackwise.plan.json`, stop and use `stack-guard` first.",
        ],
      );
    }),
  ];

  const skill = (skillName: string, fields: Record<string, string>, body: string[]): SpecFile => ({
    name: `.claude/skills/${skillName}/SKILL.md`,
    content: `${frontmatter({ name: skillName, ...fields })}${body.join("\n")}\n`,
  });

  const skills: SpecFile[] = [
    skill("next-step", { description: "Do the next unchecked task in TASKS.md with the agent it names, review it, then check it off.", "disable-model-invocation": "true" }, [
      "1. Read TASKS.md and find the first unchecked task.",
      "2. Say which task is next and which agent will do it.",
      "3. Hand the task to that agent. If it needs a service or SDK that isn't in `stackwise.plan.json`, run `stack-guard` first.",
      "4. Run `spec-reviewer` on the result. If anything fails, fix it or report it, and leave the box unchecked.",
      "5. When the review passes, check the task's box in TASKS.md and say what's next.",
    ]),
    skill("check-stack", { description: "Check this project's stack with StackWise and explain every problem, its fix and the cost.", "argument-hint": "[a change to check, like: swap Resend for Postmark]" }, [
      "Call `get_plan` and explain, in plain words, every problem with its fix, then the monthly and yearly cost.",
      "",
      "If a change was given ($ARGUMENTS), follow `stack-guard`'s steps for it instead: check it with `check_stack` or `compare_options`, and only update the plan once the person agrees.",
    ]),
  ];

  const extra: SpecFile[] = mcpReady
    ? [
        {
          name: ".mcp.json",
          content: `${JSON.stringify({ mcpServers: { stackwise: { command: "pnpm", args: ["--silent", "--dir", options.stackwiseRoot!, "mcp"] } } }, null, 2)}\n`,
        },
        { name: ".claude/settings.json", content: `${JSON.stringify({ permissions: { allow: ["mcp__stackwise"] } }, null, 2)}\n` },
      ]
    : [];

  return [...files, tasks, planFile, ...extra, ...agents, ...skills];
}
