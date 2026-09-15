import fs from "node:fs";
import path from "node:path";
import { getClient } from "@/ai/config";
import { aiPrefill, type Guess } from "@/ai/prefill";
import { prefillFromKeywords } from "@/engine/prefill";
import { casesSchema, formatComparison, scoreMethod, type MethodScore } from "./eval-core";
import { ROOT, args, projectCatalog, requireAi, writeReport } from "./lib";

/**
 * pnpm eval:prefill [--keywords-only]
 *
 * Grades the keyword baseline and the AI pre-fill against evals/prefill-cases.json and writes a
 * report to reports/. The AI half calls Claude once per case.
 */

async function main() {
  const flags = args();
  const casesPath = path.join(ROOT, "evals", "prefill-cases.json");
  const cases = casesSchema.parse(JSON.parse(fs.readFileSync(casesPath, "utf8")));
  if (cases.length === 0) {
    console.error("evals/prefill-cases.json is empty. Write cases first; see evals/README.md for the format.");
    process.exit(1);
  }

  const catalog = projectCatalog();
  const known = new Set(catalog.needs.map((n) => n.id));
  for (const item of cases) {
    for (const need of Object.keys(item.expected)) {
      if (!known.has(need)) throw new Error(`Case ${item.id} expects an unknown question "${need}".`);
    }
  }

  const scores: Record<string, MethodScore> = {};
  const keywordGuesses: Record<string, Record<string, Guess>> = {};
  for (const item of cases) {
    keywordGuesses[item.id] = Object.fromEntries(
      Object.entries(prefillFromKeywords(item.description, catalog.needs)).map(([need, words]) => [need, { answer: "yes" as const, evidence: words }]),
    );
  }
  scores.keywords = scoreMethod(cases, keywordGuesses);

  const aiGuesses: Record<string, Record<string, Guess>> = {};
  if (!flags["keywords-only"]) {
    requireAi();
    const client = getClient();
    for (const item of cases) {
      process.stdout.write(`AI pre-fill: ${item.id}... `);
      const result = await aiPrefill(client, catalog, item.description);
      aiGuesses[item.id] = result.guesses;
      console.log(`${Object.keys(result.guesses).length} answers${result.discarded.length ? `, ${result.discarded.length} dropped for bad evidence` : ""}`);
    }
    scores.ai = scoreMethod(cases, aiGuesses);
  }

  const table = formatComparison(scores);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = writeReport(`prefill-eval-${stamp}.json`, JSON.stringify({ cases: cases.length, scores, keywordGuesses, aiGuesses }, null, 2));
  console.log(`\n${cases.length} cases\n\n${table}\n\nFull results: ${report}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
