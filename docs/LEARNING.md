# How WhyStack works

A plain-English walkthrough, in the order data moves through the app. Read it with the code open.

## The one-sentence version

Facts about services live in JSON files; rules read those facts to decide whether each pair of choices works; a score ranks the choices that work; and the result becomes a spec your AI builder follows.

## The pieces

| Step | File | What it does |
|---|---|---|
| 1 | `data/*.json` | Everything WhyStack knows. Services, their facts with sources, the rules, the questions, the weights. |
| 2 | `src/engine/schema.ts`, `load.ts` | Reads the JSON and refuses to start if a file breaks the contract. |
| 3 | `src/engine/integrity.ts` | Checks across files: every rule's facts exist, every "full" option really has all its facts, no em dashes. |
| 4 | `src/engine/prefill.ts` | Turns a description into guessed answers using keywords. |
| 5 | `src/engine/followups.ts` | Picks which unanswered questions are worth asking. |
| 6 | `src/engine/evaluate.ts` | The connection logic: verdicts for a plan. |
| 7 | `src/engine/score.ts` | Ranks options, finds the best plan, spots close calls. |
| 8 | `src/engine/cost.ts` | Free at your size, or the first bill. |
| 9 | `src/engine/spec.ts` | Writes SPEC.md, SETUP.md and the builder file. |
| 10 | `src/components/*` | The workspace: planner, canvas, palette, details panel. |

## Following one app through

Say the description is: *"A booking app for my barber shop. Customers log in, pick a time, pay a deposit, and upload a photo of the haircut they want. They get a reminder text the day before, and the shop can chat with them."*

1. **Pre-fill.** `prefillFromKeywords` scans for each need's keywords. "booking" matches *saves data*, "log in" matches *login*, "pay" matches *users pay*, "upload" matches *uploads*, "reminder" matches *scheduled tasks*, "chat" matches *live updates*. Each guess keeps the matched words so the planner can show why it guessed.
2. **Confirm.** The guesses show as "yes" but marked. Clicking "Looks right, build my plan" confirms them. Until then the canvas says it's a preview.
3. **Needed slots.** `neededSlots` turns yes answers into slots: login adds Login and Database, paying adds Payments, uploads add File storage. Framework and Hosting are always needed.
4. **Search.** `recommend` tries combinations of fully researched options for those slots and keeps the best total. Blocked pairs cost 1000 points, so they lose unless nothing else works.
5. **Verdicts.** For the winning plan, `evaluatePlan` runs every rule. With Netlify and Supabase, the live-updates rule finds that Netlify can't hold live connections but Supabase pushes changes itself, so it adds a note instead of a warning.
6. **Canvas.** Each slot card shows the worst verdict touching it. The line from the app shows that slot's own checks. Problems between two slots get their own dashed line.
7. **Spec pack.** `buildSpecPack` lists the stack with its strongest reasons, turns every warning and note that has builder guidance into a rule, orders the build, and collects every environment variable name.

## Three ideas to be able to explain

**Capability rules scale; product rules don't.** Writing "Vercel plus SQLite doesn't work" as a pair means another rule for every host and every file database. Writing "a host with no permanent disk plus a database that keeps data in a local file doesn't work" once covers them all, because each option only has to declare its own facts. Look at `file-database-needs-disk` in `data/rules/capability.json`, then at `persistent_disk` in any hosting file.

**Unknown is its own state.** `readFact` returns "unknown" when a fact is missing. A condition that is unknown makes the rule unknown, unless another condition in the same rule is definitely false, in which case the rule doesn't apply at all. Nothing unknown ever becomes "works". See the tests in `evaluate.test.ts` named "never treats a missing fact as works" and "clears a rule with an unknown fact when another condition is definitely false".

**Branch and bound.** Trying every combination for all seven slots is tens of thousands of plans. `recommend` scores options one slot at a time and keeps a running total. Before going deeper it adds the best possible score for the slots still left; if even that can't beat the best plan found so far, it skips the whole branch. `score.test.ts` checks the result against a brute-force search that tries everything.

## Try it yourself

1. **Flip a fact.** In `data/options/netlify.json`, set `long_lived_connections` to `true`, refresh, and describe a chat app. The live-updates note disappears. Put it back.
2. **Break the data on purpose.** Delete `persistent_disk` from `data/options/render.json` and run `pnpm check:data`. Read the failure, then restore it.
3. **Add a rule.** Add a capability rule that warns when `needs: ["users_pay"]` and `payments.subscriptions` is `false`. Write a test for it in `evaluate.test.ts` first.
4. **Add an option.** Copy a listed file like `data/options/polar.json`, fill in every payments fact with sources, set `coverage` to `full`, and run the data checks.

## Questions to answer in your own words

- Why does WhyStack refuse to let an AI decide whether two services work together?
- What goes wrong if a product rule could turn "doesn't work" into "works"?
- Why ask only the questions that change the plan, and how does the code know which ones do?
- What would you measure to show the AI pre-fill is better than keywords?
- Why is the canvas slots now and a free-form graph later?
