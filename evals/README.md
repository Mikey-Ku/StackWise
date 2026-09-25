# Evals

Two questions StackWise should be able to answer with numbers:

1. **Does the AI pre-fill read descriptions better than keywords?** (`pnpm eval:prefill`)
2. **How often does a plain LLM, asked to pick a stack, choose one that breaks a rule, compared with StackWise's plan?** (`pnpm eval:plain-llm`)

Both read the same cases from `prefill-cases.json`.

## Who writes the cases

Michael writes every case. Claude does not generate eval questions or answers for this project. The harness, the grader and its tests exist; the cases file is empty on purpose.

## Writing and running them

1. `pnpm eval:questions` lists every question id with the question it asks. No AI, no network.
2. Add cases to `prefill-cases.json` in the format below.
3. `pnpm eval:prefill --keywords-only` checks the file (an unknown question id or a bad value stops it and says where) and grades the keyword baseline, still without AI. Run it after every few cases.
4. With `ANTHROPIC_API_KEY` in `.env.local`: `pnpm eval:prefill` grades the AI pre-fill next to the baseline, and `pnpm eval:plain-llm` compares a plain LLM's stacks with StackWise's. Each case is one Claude call per eval.

## Case format

```json
[
  {
    "id": "short-unique-id",
    "description": "The app description exactly as a beginner might type it.",
    "expected": {
      "saves_data": "yes",
      "login": "yes",
      "users_pay": "no",
      "live_updates": "unclear"
    }
  }
]
```

- `expected` keys are question ids from `data/needs.json`. Only the questions you list are graded.
- `"unclear"` means the description genuinely doesn't say. A pre-fill that leaves it unanswered is right; one that guesses is wrong.
- Write descriptions the way real people do: vague, missing things, sometimes contradicting themselves. A set where every description is clear measures nothing.

## What gets measured

`eval:prefill` grades the keyword baseline and the AI pre-fill side by side:

- **Accuracy** across every graded question
- **Yes precision**: of the questions guessed "yes", how many really were
- **Yes recall**: of the questions that really were "yes", how many were guessed
- **Opposite answers**: yes when the truth was no, or no when it was yes. These are the mistakes that change a plan.
- A per-question breakdown, to see which questions each method struggles with

`eval:plain-llm` uses each case's expected answers as confirmed answers, asks Claude to pick one option per needed part from the same list StackWise uses (names and one-line summaries only, no facts, no rules), then runs both plans through the rules engine and reports how many have something that doesn't work or a warning.

Run `pnpm eval:prefill --keywords-only` to grade the baseline without calling Claude. Results are written to `reports/` (gitignored). Both AI evals need `ANTHROPIC_API_KEY` in `.env.local`, and each case costs one Claude call.
