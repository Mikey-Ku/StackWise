import fs from "node:fs";
import path from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AI_EFFORT, AI_MODEL, FALLBACK_BETA, getClient } from "@/ai/config";
import { evaluatePlan, indexCatalog, neededSlots, type CheckResult } from "@/engine/evaluate";
import type { PlanInput, Selection } from "@/engine/schema";
import { recommend } from "@/engine/score";
import { casesSchema } from "./eval-core";
import { ROOT, projectCatalog, requireAi, writeReport } from "./lib";

/**
 * pnpm eval:plain-llm
 *
 * The question behind StackWise: how often does an AI asked to "pick a stack" choose one that
 * breaks a rule? For each case, Claude picks one option per needed part from the same list
 * StackWise uses, with names and one-line summaries but no facts and no rules. Both plans are then
 * checked by the rules engine.
 */

const SYSTEM = `You are helping a beginner choose services for a web app. For each part of the stack listed, pick exactly one option id from that part's list. Choose what you would genuinely recommend for the app described.`;

function tally(results: CheckResult[]) {
  const count = (level: string) => results.filter((r) => r.level === level).length;
  return { blocked: count("blocked"), warning: count("warning"), unknown: count("unknown"), missing: count("missing") };
}

type Tally = ReturnType<typeof tally>;
type Row = { id: string; error: string } | { id: string; llm: Tally & { selection: Selection }; stackwise: Tally & { selection: Selection } };

async function main() {
  requireAi();
  const cases = casesSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, "evals", "prefill-cases.json"), "utf8")));
  if (cases.length === 0) {
    console.error("evals/prefill-cases.json is empty. Write cases first; see evals/README.md.");
    process.exit(1);
  }
  const catalog = projectCatalog();
  const index = indexCatalog(catalog);
  const client = getClient();
  const rows: Row[] = [];

  for (const item of cases) {
    const answers = Object.fromEntries(Object.entries(item.expected).filter(([, a]) => a !== "unclear")) as PlanInput["answers"];
    const input: PlanInput = { answers, size: "up_to_1000", priority: "spend_zero" };
    const slots = neededSlots(index, input);
    const menu = slots.map((slot) => {
      const options = catalog.options.filter((o) => o.coverage === "full" && o.slots.includes(slot));
      return `${slot}:\n${options.map((o) => `- ${o.id}: ${o.name}. ${o.summary}`).join("\n")}`;
    });
    const schema = z.object({ picks: z.array(z.object({ slot: z.enum(slots as [string, ...string[]]), option: z.string() })) });

    const response = await client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: AI_EFFORT, format: betaZodOutputFormat(schema) },
      system: SYSTEM,
      messages: [{ role: "user", content: `<app>\n${item.description}\n</app>\n\nParts and options:\n\n${menu.join("\n\n")}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      rows.push({ id: item.id, error: "no usable answer" });
      continue;
    }

    const llm: Selection = {};
    for (const pick of response.parsed_output.picks) {
      const option = index.optionsById.get(pick.option);
      if (option?.slots.includes(pick.slot as never)) llm[pick.slot as keyof Selection] = pick.option;
    }
    const grounded = recommend(index, input);
    rows.push({
      id: item.id,
      llm: { selection: llm, ...tally(evaluatePlan(index, llm, input)) },
      stackwise: { selection: grounded.selection, ...tally(grounded.results) },
    });
    console.log(`${item.id}: plain LLM ${JSON.stringify(tally(evaluatePlan(index, llm, input)))}, StackWise ${JSON.stringify(tally(grounded.results))}`);
  }

  const scored = rows.filter((r): r is Extract<Row, { llm: unknown }> => "llm" in r);
  const share = (pick: (r: Extract<Row, { llm: unknown }>) => boolean) =>
    scored.length ? `${((scored.filter(pick).length / scored.length) * 100).toFixed(1)}%` : "n/a";
  const summary = [
    `Cases scored: ${scored.length} of ${rows.length}`,
    `Plain LLM plans with something that doesn't work: ${share((r) => r.llm.blocked > 0)}`,
    `Plain LLM plans with a warning: ${share((r) => r.llm.warning > 0)}`,
    `StackWise plans with something that doesn't work: ${share((r) => r.stackwise.blocked > 0)}`,
    `StackWise plans with a warning: ${share((r) => r.stackwise.warning > 0)}`,
  ].join("\n");
  const report = writeReport(`plain-llm-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ model: AI_MODEL, rows }, null, 2));
  console.log(`\n${summary}\n\nFull results: ${report}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
