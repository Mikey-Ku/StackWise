# WhyStack

Plan a web app stack you actually understand.

You describe your app in a paragraph. WhyStack picks out what it needs (logins, payments, uploads, live updates), asks you to confirm each guess, and fills a canvas with a hosting provider, database, login, file storage, payments and AI provider. Every connection on the canvas is checked by a rules engine that reads sourced facts, so each verdict comes with a reason and a link. When the plan looks right, WhyStack hands your AI builder (Lovable, Bolt, Replit, Claude Code, Cursor) a spec pack: the spec, an ordered setup checklist, and a prompt or agent file.

The AI never decides whether two services work together. Rules do, from facts with a source and a date. That is the whole idea.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:4310
```

From the Portfolio_Projects hub, the `whystack` entry in `.claude/launch.json` starts the same server.

```bash
pnpm test         # engine tests plus the data checks
pnpm check:data   # only the data checks: schemas, sources, and "every pair has a verdict"
pnpm typecheck
pnpm lint
pnpm build
```

## What works today

- **Describe, then confirm.** A paragraph becomes guessed answers, each marked with the words it matched. Guesses come from keywords for now; this is the baseline an AI pre-fill will be measured against.
- **Only the questions that matter.** A follow-up is asked only if its answer would change the plan (at most five up front, the rest optional).
- **Canvas with slots.** Your app in the middle, six slots around it. Drag options from the palette, or press Use. Dropping something in the wrong slot is refused with a reason.
- **Connection logic.** Capability rules (written about traits like "no permanent disk") plus product rules (exact pairs). A product rule can add a warning or a perk but can never turn "doesn't work" into "works". A missing fact shows as "not verified yet", never as "works".
- **Ranking.** When several options work, fixed weights for your priority (spend $0, launch fast, learn, ready to grow) rank them. Close calls are called out with what decided them.
- **Cost.** Free at your size, or the first paid plan once you outgrow it, one size ahead. Unverified prices show as unverified, never $0.
- **Spec pack.** SPEC.md, SETUP.md, and PROMPT.txt, CLAUDE.md or AGENTS.md depending on your builder. Every warning becomes a rule the builder is told to follow.

## Not built yet

- AI pre-fill of the questions (and the eval that compares it with the keyword baseline)
- The scheduled AI checker that rereads each fact's source and opens a pull request when it changes
- Accounts, saved plans across devices, share links (plans live in your browser for now)
- The free-form expert canvas, and planning mobile apps
- Reviewing the facts: all 199 are drafts (see [docs/DATA.md](docs/DATA.md))

## Where things are

```
data/                 everything WhyStack knows, as JSON
  options/*.json      one file per service, with sourced facts
  rules/              capability.json and product.json
  needs.json          the questions a beginner answers
  facts.json          what each fact means and its allowed values
  slots.json          the six slots plus framework
  planning.json       sizes, priorities and their weights, builders
src/engine/           the logic, no React, fully tested
src/components/       the workspace UI (React Flow canvas, planner, palette, details)
docs/                 DECISIONS.md, LEARNING.md, DATA.md
```

Start with [docs/LEARNING.md](docs/LEARNING.md) for how it works, and [docs/DECISIONS.md](docs/DECISIONS.md) for why it's shaped this way.
