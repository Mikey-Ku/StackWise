# WhyStack

Plan a web app stack you actually understand.

You describe your app in a paragraph. WhyStack works out what it needs (logins, payments, uploads, email, live updates, background jobs, data from other websites, your own domain), asks you to confirm each guess, and fills a canvas with a host, domain, database, login, file storage, payments, email, AI provider, web scraper, jobs service, analytics, error monitoring and, if you want one, a phone app. A rules engine checks every connection against sourced facts, so each verdict comes with a reason and a link. When the plan looks right, WhyStack hands your AI builder (Lovable, Bolt, Replit, Claude Code, Cursor) a spec pack: the spec, an ordered setup checklist, a prompt or agent file, and a decision record.

The AI never decides whether two services work together. Rules do, from facts with a source and a date. AI reads your description, explains the plan and drafts new facts for a person to review.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:4310
```

Everything works without an API key. To turn on Claude reading your description and explaining your plan, copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`.

```bash
pnpm test             # engine, AI (with a fake client), store, scripts and data checks
pnpm check:data       # only the data checks: schemas, sources, every pair gets a verdict
pnpm check:options -- --id firecrawl   # check one option file while you write it
pnpm typecheck && pnpm lint && pnpm build

pnpm eval:prefill     # AI pre-fill vs the keyword baseline (needs cases in evals/)
pnpm eval:plain-llm   # how often a plain LLM picks a stack that breaks a rule
pnpm check:sources    # reread every fact's source page with Claude; --apply to update
pnpm draft:option -- --id resend --name "Resend" --slot email --website https://resend.com
pnpm build:logos      # refetch logos into public/logos; -- --only <id,id> for a few
pnpm mcp              # WhyStack's MCP server over stdio (exported projects start it themselves)
```

## Pair with Claude

WhyStack is also an MCP server, so Claude uses its rules instead of guessing. Click **Pair with Claude** in the app, then add it to Claude Code once:

```bash
claude mcp add --transport http --scope user whystack http://localhost:4310/api/mcp
```

Claude can check stacks, compare options, estimate costs and change the plan you share; its changes appear on the canvas with its reasons, and Undo reverses them. **Export project** gives Claude Code a ready project: tasks, an agent per part, `/next-step`, and an `.mcp.json` that starts WhyStack's server. See [docs/MCP.md](docs/MCP.md).

## What it does

**Planning**
- Describe your app, or start from an example. Claude (or keywords, without a key) guesses what it needs and shows the exact words behind every guess. Guesses whose quoted words aren't really in your description are thrown out.
- Only the follow-up questions that would change your plan are asked.
- Pick a priority (spend $0, launch fast, learn, ready to grow), an audience size and your builder.

**The canvas**
- Your app in the middle, with slots for hosting, domain name, database, login, email, file storage, payments, AI, web scraping, background jobs, analytics, error monitoring and a phone app. Optional parts stay hidden until you need them, drag something that fits, or show all parts.
- Drag options from a palette of 79 (59 fully researched), or press Use. Every option has its logo, a dot for what would happen if you used it, and quick stats at your audience size: cost now, the first paid plan, how far the free plan goes, and the trait that matters for that part (a domain's renewal price, whether a scraper charges extra for JavaScript pages, whether analytics needs cookies, whether a free host falls asleep, download fees, sales tax, whether iPhone builds need a Mac). Dropping something in the wrong slot is refused with a reason.
- Drag any part where you want it. The layout is saved with the plan, and "Tidy up" puts everything back.
- Every line between the app and a service says what runs along it: the environment variables your code reads to reach that service. Click a line to see each name, where its value comes from, which ones the browser can read, and the checks on that connection. The line to your host carries every variable in the plan, because the host needs them all.
- Swap a service without leaving the canvas: "Swap" on any part lists the others that fit it.
- A strip above the canvas sums up the plan: monthly cost plus yearly and one-time costs, where the cost first jumps as you grow, accounts to sign up for, setup steps, and checks.
- Every check shows up as a colored line or badge: works, works with a warning, doesn't work, missing a piece, or not verified yet.
- Undo and redo (Cmd or Ctrl+Z).

**Understanding**
- Details for every part: its stats, every check with its reason and fix, the cost at your size, how it scored for your priority, a comparison table, and the sourced facts behind it, flagged when they may be out of date.
- Compare two or three options side by side, stat by stat, each with its note and source.
- "Explain my plan": a plain-language summary written only from the computed plan.
- Learn: what each part of an app is, what matters when choosing, where beginners slip, and a glossary of 50 terms.
- Close calls, and what would change if a "not sure" answer turned out to be yes.
- Cost at every audience size, and a line for each part of the plan, so you see each free plan run out before it happens. Domains are counted by the year, app store accounts as yearly and one-time fees, hosting shows the traffic each plan includes, and one subscription that covers several parts (like a Supabase plan) is counted once.

**Leaving with a plan**
- Project pack, as a zip: SPEC.md, SETUP.md, TASKS.md, DECISIONS.md with the reasoning for every part, the plan file, `.env.example` with every variable name grouped by service, a `.gitignore` that keeps the values out of git, and PROMPT.txt, AGENTS.md or CLAUDE.md for your builder. For Claude Code it adds `.mcp.json`, a build agent per part, a stack guard, a setup guide, a reviewer and a `/next-step` skill. Environment variable names follow your framework.
- Or write the same files straight into a folder on this computer, plus a `.env.local` with the names and no values, ready to open with `claude`. WhyStack only writes inside your home folder, never writes over an existing `.env.local`, and tells you which names yours is missing.
- Pair with Claude through WhyStack's MCP server: 11 tools, a shared plan, and a Claude tab showing what Claude did.
- Build checklist: every account, key and build step in order, checked off as you go.
- Copy the reasoning for one part, to paste into a proposal or pull request.
- Several saved plans, share links (the whole plan lives in the link, no account needed), and plan files to export and import.

**Keeping the facts true**
- Facts live in `data/` as reviewed JSON with a source, a date and a status.
- A weekly GitHub workflow rereads every source with Claude and opens a pull request with anything that changed.
- `draft:option` researches a new service into a draft file for review.

## Not built yet

- Accounts and syncing plans across devices (plans live in your browser; share links and plan files move them)
- The free-form expert canvas for queues, caches and multi-service architectures
- Planning a phone app on its own (a phone app can be added to a web plan today)
- The eval cases: `evals/prefill-cases.json` is empty on purpose, see [evals/README.md](evals/README.md)
- Reviewed facts: all 427 are drafts, see [docs/DATA.md](docs/DATA.md)

## Where things are

```
data/                 everything WhyStack knows, as JSON
  options/*.json      one file per service, with sourced facts
  rules/              capability.json and product.json
  needs.json          the questions a beginner answers
  facts.json          what each fact means and its allowed values
  slots.json          the parts of an app
  learn.json          teaching content and glossary
  logos.json          where each option's logo comes from
  planning.json       sizes, priorities and weights, builders
public/logos/         the logo files, committed
src/engine/           the logic, no React, fully tested
src/ai/               Claude pre-fill and explanations, optional
src/components/       the workspace UI
src/app/api/          status, prefill, explain, mcp, pair and local routes
src/mcp/              the MCP server, its stdio command, and shared plans in .whystack/
scripts/              evals, source checker, option drafter, logo fetcher
evals/                eval cases (written by a person) and how to run them
docs/                 DECISIONS.md, LEARNING.md, DATA.md, MCP.md
```

Start with [docs/LEARNING.md](docs/LEARNING.md) for how it works, and [docs/DECISIONS.md](docs/DECISIONS.md) for why it's shaped this way.
