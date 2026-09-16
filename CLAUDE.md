# WhyStack: orientation for Claude sessions

Planning tool for beginners building web apps with AI builders. A deterministic rules engine checks every connection in a stack against sourced facts, ranks what works, and exports a spec pack. Optional Claude features read descriptions, explain plans and keep facts fresh. Next.js 16 + React 19 + React Flow 12, TypeScript, Zod 4, Vitest 4, Anthropic SDK 0.125, pnpm 12. Styles come from Michael's mk-ui (`src/styles/mk-ui.css`, copied from `Projects/mk-ui`).

## Commands

- `pnpm dev` runs on port 4310 (hub launch config name: `whystack`)
- `pnpm test`, `pnpm check:data`, `pnpm typecheck`, `pnpm lint`, `pnpm build`
- `pnpm check:options -- --id <id,id>` checks single option files without loading the catalog (safe while others write data)
- `pnpm eval:prefill`, `pnpm eval:plain-llm`, `pnpm check:sources [--apply]`, `pnpm draft:option -- ...` (these call Claude; they read `.env.local`)
- `pnpm build:logos [-- --only <id,id>]` downloads logos into `public/logos` (network, no key)
- `pnpm mcp` runs WhyStack's MCP server over stdio; the app serves the same tools at `/api/mcp` (docs/MCP.md)

## Map

- `data/` is the product's knowledge. `src/engine/load.ts` parses it with `schema.ts`; `integrity.ts` holds the cross-file checks `data.test.ts` enforces.
- `src/engine/wiring.ts` turns a stack into connections and the environment variables that travel along each one (names, where each value comes from, whether the browser can read it), plus the `.env` file text. It never holds a value.
- `src/engine/evaluate.ts` produces verdicts. `score.ts` ranks and searches (branch and bound, tested against brute force; domains rank on first-year and renewal price, payments on the fee from a $20 sale). `cost.ts` adds yearly and one-time costs (domains, `planning.json` `fees`) and counts a shared plan once (`shared_plans`, or one option in two parts). `followups.ts` picks questions. `stats.ts` turns facts into the stats on cards, nodes, Details, Compare and the strip above the canvas. `cost.ts`, `spec.ts`, `checklist.ts`, `decisions.ts`, `share.ts`, `staleness.ts`, `summary.ts`, `prefill.ts` do what their names say.
- `data/logos.json` says where each logo comes from (Simple Icons slug or the service's site); `scripts/logos.ts` fetches them into `public/logos/`, which is committed. `Logo` in `src/components/ui.tsx` falls back to a letter if a file is missing.
- `src/ai/` is server-only: `config.ts` (model, client, errors), `prefill.ts`, `explain.ts`, `rate-limit.ts`. Routes in `src/app/api/` always fall back to keywords or a template.
- `src/components/store.ts` is all plan state as a pure reducer (plans, undo/redo, import, migration from v1); `usePlans.ts` wires it to the engine. `Workspace.tsx` lays out Planner, PlanCanvas, Palette, Inspector, LearnPanel, ChecklistPanel and the dialogs.
- `src/app/api/local/route.ts` writes a project into a folder on this computer; `src/mcp/localfiles.ts` holds the rules it follows (which folders, which files it will not replace) and is tested without a file system.
- `src/mcp/` is the MCP server: `server.ts` (11 tools over the engine), `stdio.ts` (the command exported projects start), `registry.ts` (shared plans in `.whystack/`, gitignored), `local.ts` (localhost-only guard). Routes: `src/app/api/mcp` (Streamable HTTP, stateless) and `src/app/api/pair` (the tab shares its plan and polls for Claude's changes via `usePairing.ts`). `src/engine/planops.ts` validates plan changes and builds reports; `src/engine/project.ts` builds the project pack (TASKS.md, agents, skills, `.mcp.json`).
- `scripts/` hold the evals, source checker, option drafter and logo fetcher; their pure parts (`eval-core.ts`, `source-check-core.ts`, the link ranking in `logos.ts`) are tested.

## Invariants, do not break

1. **The AI never decides compatibility.** Verdicts come from rules over facts. AI pre-fills answers (with quoted evidence that must exist in the description), explains a precomputed brief, or drafts facts for review.
2. **Unknown is never "works".** A missing fact makes a check "unknown". A null price means "no monthly plan" only on a `coverage: "full"` option.
3. **Product rules can only tighten.** Their schema has no "works" severity.
4. **Rules read at most two slots**, and only facts in that slot's `required_facts`. A `{ slot, filled }` condition checks emptiness without reading facts.
5. **Only product-rule notes are perks.** Capability-rule notes are neutral in scoring (`resultAdjustment`); a cost note once tipped storage toward the option with download fees.
6. **Every fact has a source URL, a date and a status.** New facts are `draft` until a person reviews them.
7. **No em dashes** in data, UI copy, generated files or docs. Code uses the `\u2014` escape when it has to mention one. The data, spec and AI tests check.
8. **Engine tests use fixtures** (`test-fixtures.ts`); only `data.test.ts` reads real data. AI tests use a fake client; nothing in the test suite calls the API.
9. **MCP tools only call the engine.** Claude asks WhyStack; no tool lets it decide a verdict, price or limit. `update_plan` goes through `applyPlanUpdate`, the same validation as the planner.
10. **Default model is `claude-opus-5`** at low effort with `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Don't swap models for cost without Michael asking.

## Working with Michael

- He owns decisions, the eval cases (he writes every one; never generate them), and first drafts of decision reasoning. Don't fill in the "In your words" lines in `docs/DECISIONS.md`.
- Commits are authored by him (`Michael Ku <mikeyku24@gmail.com>`, set in this repo's git config) with no Claude co-author trailer. He asked for the repo to be created; ask before pushing further unless he says so.
- Explain as you build; he wants to be able to defend every part of this in an interview.
- Never put his API keys anywhere; he adds them to `.env.local` and to GitHub secrets himself.

## Gotchas

- mk-ui's reset sets `svg { max-width: 100% }`, which shrinks React Flow's edge SVGs to 0px so edges vanish. `globals.css` overrides it inside the canvas.
- The workspace renders client-only (`ClientRoot.tsx`, `ssr: false`) because state loads from localStorage.
- React Strict Mode runs effects twice in development. The share-link import clears the hash first and remembers its token, or it imports the plan twice.
- `page.tsx` is `force-dynamic` so edits to `data/` show up on refresh.
- Browser screenshots in the preview pane can lag a render, and the console buffer keeps errors from earlier hot reloads. Verify state with `javascript_tool` after a reload.
- In the preview browser, clipboard writes fail because the document isn't focused; the share action falls back to showing the link in the toast.
- `pnpm` scripts that call Claude use `tsx --env-file-if-exists=.env.local`, which needs Node 22.9 or newer.
- Site favicons vary: some are white marks meant for dark browser tabs (the fetcher skips `prefers-color-scheme: dark` links), some are wordmarks too small to read. After `build:logos`, look at the palette; switch a bad one to a Simple Icons slug.
- The search's bound must stay tight. Counting shared accounts only at the leaf let four new parts push the all-yes plan to 25 seconds; they're counted incrementally now. `data.test.ts` fails if that plan takes over 1.5 seconds, so run it after adding parts or options.
- Some sites answer a missing icon URL with an HTML page and a 200. The logo fetcher trusts file bytes (`sniffImage`), not names or content types.
- The stdio MCP server must never write to stdout except JSON-RPC; log to stderr. `.mcp.json` runs it with `pnpm --silent --dir <WhyStack>` so the process starts in WhyStack's folder, and Claude Code passes the project in `CLAUDE_PROJECT_DIR`.
- `/api/mcp` and `/api/pair` refuse non-local Host and Origin headers. Test them with `curl` against localhost, or the SDK's `StreamableHTTPClientTransport`.
- The canvas fits only after React Flow has measured every node (`AutoFit` reads the store) and never zooms past 100%. Fitting on `useNodesInitialized` alone ran before new nodes had sizes and left the canvas zoomed in on the old ones. Parts are spaced evenly among the visible ones, on an ellipse that grows with their count, until someone moves them.
- Node positions are middles (`nodeOrigin={[0.5, 0.5]}`), but React Flow hands back the top left corner in `onNodeDragStop`, so `land()` adds half the measured size. Without that every part hops up and left by half its size as it lands. Controls inside a node need `nodrag` (and `nowheel` for anything that scrolls) or pressing them starts a drag.
- Moving a part and tidying up are not undoable, like checking a box: undo stays about the plan. `plan.layout` is per plan, lives only in the browser, and is not in `SharedPlan`, so Claude can't move things.
- `/api/local` refuses anything outside the home folder, hidden and system folders, WhyStack's own folder, and never replaces an existing `.env.local`. Michael's keys are his: WhyStack writes names with empty values and says which names his file is missing.
- Never call `navigator.clipboard.readText()` from a Playwright evaluate: Chrome waits on a permission prompt and the tool hangs. Capture copied text by wrapping `writeText`.
- The right panel is 340px. Anything new in Details or the palette needs to wrap; long URLs and env var names in the checklist use `overflow-wrap: anywhere`.
