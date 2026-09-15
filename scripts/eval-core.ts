import { z } from "zod";
import type { Guess } from "@/ai/prefill";

/**
 * Scoring for the pre-fill eval. The cases themselves live in evals/prefill-cases.json and are
 * written by Michael, never generated; this file only knows how to grade guesses against them.
 */

export const caseSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  expected: z.record(z.string(), z.enum(["yes", "no", "unclear"])),
});
export const casesSchema = z.array(caseSchema);
export type EvalCase = z.infer<typeof caseSchema>;

export interface MethodScore {
  total: number;
  correct: number;
  accuracy: number;
  /** Of the questions guessed "yes", how many really were yes. */
  yesPrecision: number | null;
  /** Of the questions that really were yes, how many were guessed. */
  yesRecall: number | null;
  /** Guessed yes or no when the right answer was the opposite. The costly mistake. */
  wrongDirection: number;
  perNeed: Record<string, { total: number; correct: number }>;
}

export function predicted(guesses: Record<string, Guess>, need: string): "yes" | "no" | "unclear" {
  return guesses[need]?.answer ?? "unclear";
}

export function scoreMethod(cases: EvalCase[], guessesByCase: Record<string, Record<string, Guess>>): MethodScore {
  let total = 0;
  let correct = 0;
  let guessedYes = 0;
  let rightYes = 0;
  let actualYes = 0;
  let wrongDirection = 0;
  const perNeed: MethodScore["perNeed"] = {};

  for (const item of cases) {
    const guesses = guessesByCase[item.id] ?? {};
    for (const [need, truth] of Object.entries(item.expected)) {
      const guess = predicted(guesses, need);
      const ok = guess === truth;
      total++;
      if (ok) correct++;
      perNeed[need] ??= { total: 0, correct: 0 };
      perNeed[need].total++;
      if (ok) perNeed[need].correct++;
      if (guess === "yes") guessedYes++;
      if (truth === "yes") actualYes++;
      if (guess === "yes" && truth === "yes") rightYes++;
      if ((guess === "yes" && truth === "no") || (guess === "no" && truth === "yes")) wrongDirection++;
    }
  }

  return {
    total,
    correct,
    accuracy: total ? correct / total : 0,
    yesPrecision: guessedYes ? rightYes / guessedYes : null,
    yesRecall: actualYes ? rightYes / actualYes : null,
    wrongDirection,
    perNeed,
  };
}

const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);

export function formatComparison(scores: Record<string, MethodScore>): string {
  const methods = Object.keys(scores);
  const rows = [
    `| Metric | ${methods.join(" | ")} |`,
    `|---|${methods.map(() => "---").join("|")}|`,
    `| Accuracy | ${methods.map((m) => pct(scores[m].accuracy)).join(" | ")} |`,
    `| Yes precision | ${methods.map((m) => pct(scores[m].yesPrecision)).join(" | ")} |`,
    `| Yes recall | ${methods.map((m) => pct(scores[m].yesRecall)).join(" | ")} |`,
    `| Opposite answers | ${methods.map((m) => String(scores[m].wrongDirection)).join(" | ")} |`,
  ];
  const needs = [...new Set(methods.flatMap((m) => Object.keys(scores[m].perNeed)))].sort();
  const perNeed = [
    `| Question | ${methods.join(" | ")} |`,
    `|---|${methods.map(() => "---").join("|")}|`,
    ...needs.map((need) => `| ${need} | ${methods.map((m) => {
      const s = scores[m].perNeed[need];
      return s ? `${s.correct}/${s.total}` : "-";
    }).join(" | ")} |`),
  ];
  return [...rows, "", ...perNeed].join("\n");
}
