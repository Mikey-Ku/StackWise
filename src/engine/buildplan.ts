import { BUILD_ORDER, adaptEnvName } from "./checklist";
import { evaluatePlan, optionIn, type CatalogIndex, type CheckResult } from "./evaluate";
import { extraResults, LINK_WORDS, linkVerdict, type Link } from "./extras";
import { buildTask, isOwn } from "./own";
import type { PlanInput, Selection, SlotId } from "./schema";
import type { CustomPart, SharedPlan } from "./share";
import { envForSlot, planEnv } from "./wiring";

/**
 * The build plan: the canvas turned into work, in an order a coding agent can follow. Every part
 * is a task, and so is everything drawn on top of the parts: a second service in a part, a part
 * built by hand, a part StackWise doesn't list, and each line between two things. Each task says
 * what to build, the person's note on it word for word, the variables it reads, what has to be
 * done first, what "done" means, and the problems the rules found that touch it.
 *
 * TASKS.md is written from it, the `get_build_plan` MCP tool returns it, and "Build this with"
 * sends one task to a paired agent. Nothing here decides anything: tasks come from the plan,
 * the setup facts and the rules' results.
 */

export type TaskKind = "setup" | "part" | "own" | "extra" | "custom" | "link";

export interface BuildTask {
  /** "setup", "part:<slot>", "extra:<part>.<name>", "custom:<id>" or "link:<from>><to>". */
  id: string;
  kind: TaskKind;
  title: string;
  /** What to build, in a sentence or two. */
  task: string;
  /** The person's note on it, word for word. */
  note?: string;
  /** Environment variable names the code reads for it, as the env file names them. */
  env: string[];
  /** Tasks to finish first, by id. */
  after: string[];
  doneWhen: string[];
  /** The agent in `.claude/agents/` that builds it, when there is one. */
  agent?: string;
  /** Problems the rules found that touch it, one line each. */
  watch: string[];
  /** The part on the canvas it belongs to, so a conversation about it lands on that part. */
  slot: SlotId;
}

/** The parts of a plan the build plan reads beyond the stack itself. */
export type BuildLayout = Pick<SharedPlan, "notes"> & Partial<Pick<SharedPlan, "custom" | "links">>;

const PROBLEM_LEVELS = new Set(["blocked", "missing", "warning", "unknown"]);
const LEVEL_WORD: Record<string, string> = { blocked: "Blocked", missing: "Missing", warning: "Warning", unknown: "Not checked" };

const oneLine = (text: string) => text.trim().replace(/\s*\n\s*/g, " ");
const watchLine = (r: CheckResult) => `${LEVEL_WORD[r.level] ?? r.level}: ${r.title}.${r.fix ? ` Fix: ${r.fix}` : ""}`;

const LINK_TASK: Record<Link["kind"], (from: string, to: string, what: string) => string> = {
  calls: (from, to, what) => `Make ${from} call ${to}${what ? ` for ${what}` : ""}.`,
  webhook: (from, to, what) => `Have ${from} send webhooks${what ? ` (${what})` : ""} to ${to}, and handle them there.`,
  reads: (from, to, what) => `Make ${from} read ${what || "what it needs"} from ${to}.`,
  writes: (from, to, what) => `Make ${from} write ${what || "its data"} to ${to}.`,
  sends_events: (from, to, what) => `Send ${what || "events"} from ${from} to ${to}.`,
  dns: (from, to) => `Point ${from}'s DNS records at ${to}.`,
};

export function buildPlan(index: CatalogIndex, input: PlanInput, selection: Selection, layout: BuildLayout): BuildTask[] {
  const extras = input.extras ?? {};
  const custom: Record<string, CustomPart> = layout.custom ?? {};
  const results = [...evaluatePlan(index, selection, { ...input, extras: undefined }), ...extraResults(index, selection, input)];
  const vars = planEnv(index, selection, extras);
  const problems = (keep: (r: CheckResult) => boolean) => results.filter((r) => PROBLEM_LEVELS.has(r.level) && r.source !== "missing" && keep(r)).map(watchLine);

  const partName = (slot: SlotId) => optionIn(index, selection, slot)?.name ?? index.slotsById.get(slot)?.label ?? slot;
  /** A readable name for anything a line can join, and the task that builds it. */
  const end = (id: string): { name: string; task: string; slot: SlotId } | null => {
    if (id === "app" || id === "framework") return { name: "the app", task: "part:framework", slot: "framework" };
    if (extras[id]) {
      const option = index.optionsById.get(extras[id].option);
      return { name: `${option?.name ?? extras[id].option} (${extras[id].role || id})`, task: `extra:${id}`, slot: extras[id].slot };
    }
    if (custom[id]) return { name: custom[id].name, task: `custom:${id}`, slot: "framework" };
    if (index.slotsById.has(id as SlotId) && selection[id as SlotId]) return { name: partName(id as SlotId), task: `part:${id}`, slot: id as SlotId };
    return null;
  };

  const partTask = (slot: SlotId): BuildTask | null => {
    const option = optionIn(index, selection, slot);
    const def = index.slotsById.get(slot);
    if (!option || !def) return null;
    const own = isOwn(option.id);
    const env = own ? [] : [...new Set(option.setup.flatMap((s) => s.env.map((e) => adaptEnvName(e, selection.framework))))];
    const note = layout.notes?.[slot];
    return {
      id: `part:${slot}`,
      kind: own ? "own" : "part",
      title: `${def.label}: ${own ? "your own" : option.name}`,
      task: buildTask(def, option),
      ...(note?.text.trim() ? { note: oneLine(note.text) } : {}),
      env,
      after: slot === "framework" ? ["setup"] : ["part:framework"],
      doneWhen: [
        "It works end to end in the running app.",
        ...(env.length ? [`Settings come from environment variables (${env.map((e) => `\`${e}\``).join(", ")}), and no secret reaches the browser.`] : []),
        `It follows the rules in \`.claude/agents/build-${slot}.md\`.`,
        "`spec-reviewer` passes.",
      ],
      agent: `build-${slot}`,
      watch: own ? [] : problems((r) => r.slots.includes(slot) && !r.instance),
      slot,
    };
  };

  const extraTask = (id: string): BuildTask | null => {
    const extra = extras[id];
    const option = index.optionsById.get(extra.option);
    const def = index.slotsById.get(extra.slot);
    if (!option || !def) return null;
    const env = envForSlot(vars, extra.slot, id).map((v) => v.name);
    const role = extra.role || id.split(".")[1];
    return {
      id: `extra:${id}`,
      kind: "extra",
      title: `${def.label}: ${option.name} (${role})`,
      task: `${buildTask(def, option)} It's a second ${def.label.toLowerCase()} service next to ${partName(extra.slot)}, for ${role}; keep the two apart in the code.`,
      ...(extra.note?.trim() ? { note: oneLine(extra.note) } : {}),
      env,
      after: [`part:${extra.slot}`],
      doneWhen: [
        "It works end to end in the running app, next to the first service.",
        ...(env.length ? [`It reads its own variables (${env.map((e) => `\`${e}\``).join(", ")}), not the first service's.`] : []),
        "`spec-reviewer` passes.",
      ],
      agent: `build-${extra.slot}`,
      watch: problems((r) => r.instance === id),
      slot: extra.slot,
    };
  };

  const customTask = (id: string): BuildTask => {
    const part = custom[id];
    return {
      id: `custom:${id}`,
      kind: "custom",
      title: `${part.name} (added by you)`,
      task: `Connect the app to ${part.name}${part.role ? `: the app ${part.role} it` : ""}.${part.url ? ` Its docs: ${part.url}.` : ""}`,
      ...(part.note.trim() ? { note: oneLine(part.note) } : {}),
      env: part.env,
      after: ["part:framework"],
      doneWhen: ["It works end to end in the running app.", ...(part.env.length ? ["Its settings come from environment variables, and no secret reaches the browser."] : []), "`spec-reviewer` passes."],
      // StackWise has no facts on it, so there is nothing to check and no agent that knows it.
      watch: ["Not checked: StackWise has no facts on it. Read its docs for limits and prices."],
      slot: "framework",
    };
  };

  const linkTask = (link: Link): BuildTask | null => {
    const from = end(link.from);
    const to = end(link.to);
    if (!from || !to) return null;
    const verdict = linkVerdict(index, results, link, selection, input);
    const slot = from.slot !== "framework" ? from.slot : to.slot;
    const what = link.what ? oneLine(link.what) : "";
    // Only "the app" starts with a capital at the front of a sentence; a service keeps its own spelling.
    const cap = (text: string) => (text === "the app" ? "The app" : text);
    return {
      id: `link:${link.from}>${link.to}`,
      kind: "link",
      title: `${cap(from.name)} ${LINK_WORDS[link.kind]} ${to.name}`,
      task: LINK_TASK[link.kind](from.name, to.name, what),
      env: [],
      after: [...new Set([from.task, to.task])],
      doneWhen: [`It works in the running app: ${from.name} ${LINK_WORDS[link.kind]} ${to.name}, and a failure on either side is handled.`, "`spec-reviewer` passes."],
      ...(slot !== "framework" ? { agent: `build-${slot}` } : {}),
      watch: verdict.checked ? verdict.results.filter((r) => PROBLEM_LEVELS.has(r.level)).map(watchLine) : ["Not checked: no StackWise rule reads these two together. Read both services' docs."],
      slot,
    };
  };

  // The parts in build order, each followed by its extras; parts added by hand after the parts they
  // plug into, before hosting, which ships everything. Each line goes right after its later end.
  const setup: BuildTask = {
    id: "setup",
    kind: "setup",
    title: "Accounts and keys",
    task: "Create the accounts and keys in SETUP.md, and put each value in `.env.local`.",
    env: [],
    after: [],
    doneWhen: ["Every account in SETUP.md exists.", "`.env.local` has a value for each name in `.env.example` and stays out of git."],
    agent: "setup-guide",
    watch: [],
    slot: "framework",
  };
  const base: BuildTask[] = [setup];
  const withExtras = (slot: SlotId) => {
    const part = partTask(slot);
    if (!part) return;
    base.push(part);
    for (const id of Object.keys(extras).filter((id) => extras[id].slot === slot).sort()) {
      const task = extraTask(id);
      if (task) base.push(task);
    }
  };
  for (const slot of BUILD_ORDER.filter((s) => s !== "hosting")) withExtras(slot);
  for (const id of Object.keys(custom).sort()) base.push(customTask(id));
  withExtras("hosting");
  const hosting = base.find((t) => t.id === "part:hosting");
  if (hosting) hosting.after = base.filter((t) => t !== hosting && t.kind !== "setup" && !t.id.startsWith("extra:hosting.")).map((t) => t.id);

  const lines = Object.values(layout.links ?? {}).flatMap((link) => linkTask(link) ?? []);
  const ordered: BuildTask[] = [];
  const done = new Set<string>();
  for (const task of base) {
    ordered.push(task);
    done.add(task.id);
    for (const line of lines) {
      if (!done.has(line.id) && line.after.every((id) => done.has(id))) {
        ordered.push(line);
        done.add(line.id);
      }
    }
  }
  return ordered;
}

/** "Stripe and the app", or the first few names and how many more. */
function afterText(task: BuildTask, byId: Map<string, BuildTask>): string {
  const names = task.after.map((id) => byId.get(id)?.title ?? id);
  return names.length > 3 ? `${names.slice(0, 3).join("; ")} and ${names.length - 3} more` : names.join("; ");
}

/** TASKS.md: every task in order, with a box to check. */
export function buildPlanMarkdown(tasks: BuildTask[], details: { appName: string; generatedOn: string; problems?: boolean }): string {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const [setup, ...rest] = tasks;
  return [
    `# Tasks for ${details.appName.trim() || "My app"}`,
    "",
    `Planned with StackWise on ${details.generatedOn}. Work top to bottom: each task only needs the ones above it. In Claude Code, \`/next-step\` does the next unchecked task with the agent it names. Check a box only when everything under "Done when" is true.`,
    "",
    "## 0. Before you build",
    "",
    `- [ ] ${setup.task}${setup.agent ? ` Agent: \`${setup.agent}\`` : ""}`,
    ...(details.problems ? ['- [ ] Fix or accept each problem under "Problems to watch" in SPEC.md. Agent: `stack-guard`'] : []),
    "",
    ...rest.flatMap((task, i) => [
      `## ${i + 1}. ${task.title}`,
      "",
      `- [ ] ${task.task}${task.agent ? ` Agent: \`${task.agent}\`` : ""}`,
      "",
      ...(task.note ? [`The person's note: ${task.note}`, ""] : []),
      // Only lines and hand-added parts say what they wait for; the order already covers the parts.
      ...((task.kind === "link" || task.kind === "extra") && task.after.length ? [`After: ${afterText(task, byId)}.`, ""] : []),
      ...(task.watch.length ? ["Watch:", "", ...task.watch.map((w) => `- ${w}`), ""] : []),
      "Done when:",
      "",
      ...task.doneWhen.map((line) => `- ${line}`),
      "",
    ]),
  ].join("\n");
}

/** One line per task, for an agent deciding what to do next. */
export function buildPlanDigest(tasks: BuildTask[]): string {
  return tasks
    .map((t, i) => `${i}. [${t.id}] ${t.title}${t.agent ? ` (agent ${t.agent})` : ""}${t.watch.length ? `, ${t.watch.length} to watch` : ""}${t.kind === "link" ? `, after ${t.after.join(" + ")}` : ""}`)
    .join("\n");
}

/**
 * One task as a message to a coding agent: what to build and how to know it's done. The note is
 * the person's words about the part, so it's marked as theirs.
 */
export function taskBrief(tasks: BuildTask[], id: string, appName = ""): string | null {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return [
    `Build this part of ${appName.trim() || "the app"} (StackWise task ${task.id}): ${task.title}.`,
    "",
    task.task,
    ...(task.note ? ["", `The person's note on it: ${task.note}`] : []),
    ...(task.env.length ? ["", `Variables it reads: ${task.env.join(", ")}. Names only; the values are in .env.local.`] : []),
    ...(task.after.length ? ["", `Needs first: ${afterText(task, byId)}. If one isn't built yet, say so before starting.`] : []),
    ...(task.watch.length ? ["", "Watch:", ...task.watch.map((w) => `- ${w}`)] : []),
    "",
    "Done when:",
    ...task.doneWhen.map((w) => `- ${w}`),
    "",
    `Follow CLAUDE.md or AGENTS.md in the project${task.agent ? ` and the \`${task.agent}\` agent if it's there` : ""}. Check any change to the stack with StackWise first (check_stack), and reply here with what you built.`,
  ].join("\n");
}
