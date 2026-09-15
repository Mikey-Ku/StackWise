# How WhyStack works

A plain-English walkthrough, in the order data moves through the app. Read it with the code open.

## The one-sentence version

Facts about services live in JSON files; rules read those facts to decide whether each pair of choices works; a score ranks the choices that work; and the result becomes a spec your AI builder follows. Claude sits at the edges: it reads what you typed and explains what the rules decided, but it never decides.

## The pieces

| Step | File | What it does |
|---|---|---|
| 1 | `data/*.json` | Everything WhyStack knows: services and their sourced facts, the rules, the questions, the weights, the teaching content. |
| 2 | `src/engine/schema.ts`, `load.ts` | Reads the JSON and refuses to start if a file breaks the contract. |
| 3 | `src/engine/integrity.ts` | Checks across files: every rule's facts exist, every "full" option has all its facts, no em dashes. |
| 4 | `src/ai/prefill.ts`, `src/engine/prefill.ts` | Turns a description into guessed answers: Claude with quoted evidence, or keywords. |
| 5 | `src/engine/followups.ts` | Picks which unanswered questions are worth asking. |
| 6 | `src/engine/evaluate.ts` | The connection logic: verdicts for a plan. |
| 7 | `src/engine/score.ts` | Ranks options, finds the best plan, spots close calls. |
| 8 | `src/engine/cost.ts` | Free at your size, or the first bill, at every size. |
| 9 | `src/engine/summary.ts`, `src/ai/explain.ts` | The plan brief, explained by a template or by Claude. |
| 10 | `src/engine/spec.ts`, `decisions.ts`, `checklist.ts` | The spec pack, the decision record and the build checklist. |
| 11 | `src/components/store.ts` | Every saved plan, undo and redo, share links and imports, as a pure reducer. |
| 12 | `src/components/*` | The workspace: planner, canvas, options, details, Learn, Checklist. |
| 13 | `scripts/*` | Evals, the source checker and the option drafter. |

## Following one app through

Say the description is: *"A booking app for my barber shop. Customers log in, pick a time, pay a deposit, and upload a photo of the haircut they want. They get a reminder email the day before, and the shop can chat with them."*

1. **Pre-fill.** The planner posts the description to `/api/prefill`. With an API key, Claude answers each question and must quote the words behind every yes or no; `acceptAnswers` throws out any quote that isn't really in the description. Without a key, `prefillFromKeywords` matches keywords instead: "booking" for *saves data*, "log in" for *login*, "pay" for *users pay*, "upload" for *uploads*, "email" for *sends email*, "reminder" for *scheduled tasks*, "chat" for *live updates*.
2. **Confirm.** Guesses show as answers but stay marked, with their evidence. "Looks right, build my plan" confirms them all. Until then the canvas says it's a preview.
3. **Needed slots.** `neededSlots` turns yes answers into parts: login adds Login and Database, paying adds Payments, uploads add File storage, email adds Email, your own address adds Domain name, pulling data from other websites adds Web scraping, and wanting usage numbers or error alerts adds Analytics or Error monitoring. Framework and Hosting are always needed. Background jobs and a phone app are optional parts you add yourself.
4. **Search.** `recommend` tries combinations of fully researched options for those parts and keeps the best total. A blocked pair costs 1000 points, so it loses unless nothing else works.
5. **Verdicts.** For the winning plan, `evaluatePlan` runs every rule. If the host can't run scheduled jobs and there's no jobs service, "No built-in way to run things on a schedule" appears; drag a jobs service onto the canvas and it clears.
6. **Canvas.** Each card shows the worst verdict touching that part. The line from the app shows that part's own checks. Problems between two parts get their own dashed line.
7. **Leaving.** The spec pack lists the stack with its strongest reasons, turns every warning and note with builder guidance into a rule, orders the build, renames environment variables for your framework, and writes a decision record for every part. The Checklist tab tracks the same steps as you do them.

## Ideas to be able to explain

**Capability rules scale; product rules don't.** Writing "Vercel plus SQLite doesn't work" as a pair means another rule for every host and every file database. Writing "a host with no permanent disk plus a database that keeps data in a local file doesn't work" once covers them all, because each option only declares its own facts. See `file-database-needs-disk` in `data/rules/capability.json`, then `persistent_disk` in any hosting file.

**Unknown is its own state.** `readFact` returns "unknown" when a fact is missing. A condition that is unknown makes the rule unknown, unless another condition in the same rule is definitely false, in which case the rule doesn't apply at all. Nothing unknown ever becomes "works". See the tests in `evaluate.test.ts` named "never treats a missing fact as works" and "clears a rule with an unknown fact when another condition is definitely false".

**Some rules check for an empty part.** A condition like `{ "slot": "jobs", "filled": false }` reads no facts; it's true while nothing is in Background jobs. That's how adding a service resolves a warning. During plan search, a part outside the search is always empty, so a rule touching it is treated as a one-part rule. The test "stays exact when rules check slots outside the search" proves the search still finds the true best plan.

**Branch and bound.** With every question answered yes, trying every combination is tens of millions of plans. `recommend` scores options one part at a time and keeps a running total. Before going deeper it adds the best possible score for the parts still left; if even that can't beat the best plan so far, it skips the whole branch. `score.test.ts` checks the result against a brute-force search.

**A loose bound is a slow search.** Shared accounts used to be counted only once a plan was complete, so the bound had to assume every remaining part might share an account. Adding four parts took the all-yes plan from milliseconds to 25 seconds. Now a shared account is counted the moment the second part from that provider is placed, and a part only gets that allowance if one of its options could share a provider with an earlier part, so the bound is tight and the same plan takes a few milliseconds. Among plans that tie exactly, the first one found wins, which is still the same every time.

**Only real pairings are perks.** A product rule's note (Supabase Auth and the Supabase database share a project) adds a small bonus. A capability rule's note is neutral, because notes like "downloads cost money" aren't good news. The test "doesn't let a cost note count as a perk" covers the bug that taught this.

**How the AI is kept honest.** Three layers: the model only answers fixed questions with structured output, every yes or no must quote the description and fake quotes are dropped, and explanations are written from a brief of already-decided verdicts. Everything a model writes passes `withoutEmDashes` before it reaches the page. With no key, or any error or refusal, the keyword and template paths take over. `src/ai/ai.test.ts` runs all of this against a fake client.

**Share links need no server.** `encodeSharedPlan` turns the plan's answers and choices into JSON, compresses it with the browser's `CompressionStream`, and base64url-encodes it into `#plan=` in the link. Opening the link decodes, validates with the same Zod schema, and imports it as a new plan.

**Undo is snapshots.** Every change that alters the plan pushes the previous plan onto a history stack in `store.ts`; typing and checking boxes don't. Undo swaps the current plan for the last snapshot. Because the reducer is pure, `store.test.ts` tests it without a browser.

## Try it yourself

1. **Flip a fact.** In `data/options/netlify.json`, set `scheduled_jobs` to `false`, refresh, and plan something with a daily email. Watch the schedule warning appear, then drag Inngest into Background jobs and watch it clear. Put the fact back.
2. **Break the data on purpose.** Delete `persistent_disk` from `data/options/render.json` and run `pnpm check:data`. Read the failure, then restore it.
3. **Add a rule.** Add a capability rule that warns when `needs: ["users_pay"]` and `payments.subscriptions` is `false`. Write its test in `evaluate.test.ts` first.
4. **Grade the baseline.** Write three cases in `evals/prefill-cases.json` and run `pnpm eval:prefill --keywords-only`.

## Questions to answer in your own words

- Why does WhyStack refuse to let an AI decide whether two services work together?
- What goes wrong if a product rule could turn "doesn't work" into "works"?
- Why ask only the questions that change the plan, and how does the code know which ones do?
- How would you show the AI pre-fill is better than keywords, and what number would convince you?
- Why is a missing quote treated as "unclear" instead of trusting the model?
- Why is the canvas slots now and a free-form graph later?
- Why did adding four parts make the search 1,000 times slower, and what made it fast again?
- Why are domains and payment services ranked on different price facts than everything else?
