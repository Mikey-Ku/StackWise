# WhyStack: orientation for Claude sessions

Planning tool for beginners building web apps with AI builders. A deterministic rules engine checks every connection in a stack against sourced facts, ranks what works, and exports a spec pack. Next.js 16 + React 19 + React Flow 12, TypeScript, Zod 4, Vitest 4, pnpm 12. Styles come from Michael's mk-ui (`src/styles/mk-ui.css`, copied from `Projects/mk-ui`).

## Commands

- `pnpm dev` runs on port 4310 (hub launch config name: `whystack`)
- `pnpm test`, `pnpm check:data`, `pnpm typecheck`, `pnpm lint`, `pnpm build`

## Map

- `data/` is the product's knowledge. `src/engine/load.ts` parses it with the schemas in `src/engine/schema.ts`; `src/engine/integrity.ts` holds the cross-file checks the data tests enforce.
- `src/engine/evaluate.ts` produces verdicts. `score.ts` ranks and searches (branch and bound, tested against brute force). `followups.ts` decides which questions matter. `cost.ts`, `spec.ts`, `prefill.ts` are what their names say.
- `src/components/usePlan.ts` is all UI state (reducer + localStorage) and derived engine results. `Workspace.tsx` lays out Planner, PlanCanvas, Palette and Inspector.

## Invariants, do not break

1. **The AI never decides compatibility.** Verdicts come from rules over facts. AI may pre-fill answers, explain, or draft facts for review.
2. **Unknown is never "works".** A missing fact makes a check "unknown". A null price counts as "no monthly plan" only on an option with `coverage: "full"`.
3. **Product rules can only tighten.** Their schema has no "works" severity. If a capability rule wrongly blocks a pair, fix the facts.
4. **Rules read at most two slots**, and only facts listed in that slot's `required_facts`, so full coverage guarantees every check can run.
5. **Every fact has a source URL, a retrieved date and a status.** New facts are `draft` until a person reviews them.
6. **No em dashes** anywhere: data, UI copy, generated specs, docs. The data tests and spec tests check for them.
7. **Engine tests use fixtures** (`test-fixtures.ts`), so provider price changes never break logic tests. Only `data.test.ts` reads real data.

## Working with Michael

- He owns decisions, the eval set (he writes every eval case), and first drafts of decision reasoning. See `docs/DECISIONS.md`; don't fill in his "reasoning in your words" lines.
- Commits are authored by him with no Claude co-author trailer, and he pushes. Leave changes uncommitted unless he asks.
- Explain as you build; he wants to be able to defend every part of this in an interview.

## Gotchas

- mk-ui's reset sets `svg { max-width: 100% }`, which shrinks React Flow's edge SVGs to 0px so edges vanish. `globals.css` overrides it inside the canvas.
- The workspace renders client-only (`ClientRoot.tsx`, `ssr: false`) because state loads from localStorage.
- `page.tsx` is `force-dynamic` so edits to `data/` show up on refresh.
- Browser screenshots in the preview pane can lag a render; verify state with `javascript_tool` before trusting a stale image.
