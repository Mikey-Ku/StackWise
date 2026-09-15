# The data

Everything WhyStack knows is in `data/`. Changes go through pull requests, and `pnpm check:data` must pass. As of 2026-09-15: 10 parts, 58 options (38 fully researched), 258 facts, 33 capability rules, 6 product rules, 11 questions, and 39 glossary terms.

## Options: `data/options/<id>.json`

```json
{
  "id": "render",
  "name": "Render",
  "provider": "render",
  "slots": ["hosting"],
  "summary": "One plain sentence a beginner understands.",
  "website": "https://render.com",
  "coverage": "full",
  "facts": {
    "persistent_disk": {
      "value": "paid_addon",
      "note": "Plain-language explanation naming the real limit.",
      "source": "https://render.com/docs/disks",
      "retrieved": "2026-09-15",
      "status": "draft"
    }
  },
  "setup": [{ "step": "Create a Render account and connect your repo.", "env": [], "source": "https://..." }],
  "builder_notes": ["Short instruction for an AI builder."]
}
```

- **Facts** must use a key from `data/facts.json` and a value of the type it defines.
- **Coverage.** `full` promises every fact listed in the slot's `required_facts` (in `data/slots.json`). `partial` options still appear in the palette, marked "not verified yet", and are never auto-picked.
- **Null.** For `first_paid_usd_month`, null means "no monthly plan" on a `full` option. Everywhere else, null means unverified.
- **Provider** groups options that share an account (Supabase database, auth and storage all use `supabase`). Providers listed in `planning.json` under `no_account_providers` don't count as accounts.

## Rules

**Capability rules** (`data/rules/capability.json`) are written about traits:

```json
{
  "id": "file-database-needs-disk",
  "severity": "blocked",
  "needs": [],
  "when": [
    { "slot": "hosting", "fact": "persistent_disk", "is": "none" },
    { "slot": "database", "fact": "storage_model", "is": "local_file" }
  ],
  "title": "Your data would disappear",
  "explanation": "{hosting} doesn't give your app a permanent disk...",
  "fix": "Pick a hosted database...",
  "builder": "Do not store app data in files on the server."
}
```

- Conditions use exactly one of `is`, `in` or `not`. `key_from_slot` reads a map fact by the id of the option in another slot (framework support).
- A condition can instead be `{ "slot": "jobs", "filled": false }`: true while that part is empty. It reads no facts. A rule built only from `filled: false` conditions is rejected, because it would fire on almost every plan.
- A rule reads at most two slots, and only facts in those slots' `required_facts`.
- `sources` lists links for any number written into the rule text itself (like app store fees).
- `needs` switch a rule on only when the beginner confirmed "yes".
- `{slot}` placeholders become option names.

**Product rules** (`data/rules/product.json`) name an exact pair. Their severity can be `blocked`, `warning` or `info`, never "works", so they can't overrule a capability rule. A product rule's `info` note is a perk and adds a small bonus to a plan's score; a capability rule's `info` note is neutral.

## Logos: `data/logos.json`

Every option needs a logo. Each entry says where it comes from, and `pnpm build:logos` downloads it into `public/logos/` and fills in `file` and `source`:

```json
{
  "vercel": { "from": "simple-icons", "slug": "vercel", "file": "vercel.svg", "source": "https://simpleicons.org/?q=vercel" },
  "groq": { "from": "site", "url": "https://groq.com", "file": "groq.png", "source": "https://groq.com/apple-touch-icon.png" }
}
```

- **`simple-icons`** draws the brand's mark from the [Simple Icons](https://simpleicons.org) package in its brand color. Near-white brand colors are drawn in ink so they show on white cards. Prefer this when the brand is there.
- **`site`** takes the icon the company's own website declares: apple-touch-icon first, then SVG, then the largest icon, then `/favicon.ico`, then Google's favicon service for sites that refuse scripted requests. Icons marked for dark mode are skipped because they're usually white.
- To add or fix one, write the entry with only `from` and `slug` or `url`, then run `pnpm build:logos -- --only <id>` and look at it in the palette. `draft:option` fetches the site icon for a new service on its own.
- The files are committed, so the app never loads a logo from another site. Logos are trademarks of their owners and are shown only to identify each service.

## Stats

The numbers on cards, canvas parts, Details and Compare come from `src/engine/stats.ts`, read from the facts above. Nothing new is stored. An unverified fact shows as "Not verified" and never as a guess, and cards skip a stat the cost already implies.

## Teaching content: `data/learn.json`

`slots` has one entry per part (`what`, `why`, `choosing`, `watch_for`, `terms`), and `terms` is the glossary (`term`, `plain`, `matters`). Every term a part mentions must exist. It is written to stay true: no prices, limits or dates.

## Adding or refreshing facts with Claude

- `pnpm check:sources` rereads the page behind each fact and reports what's still supported, what changed and what's unclear. `--apply` edits the data: confirmed facts get today's date, contradicted facts get the corrected value only when it has the right type, and go back to `draft`. `--option <id>` and `--limit <pages>` narrow it. The weekly workflow in `.github/workflows/source-check.yml` does this and opens a pull request; it needs the `ANTHROPIC_API_KEY` secret and "Allow GitHub Actions to create and approve pull requests" in the repo settings.
- `pnpm draft:option -- --id <id> --name "<Name>" --slot <slot> --website <url>` researches a service with web search and writes a draft file. Anything it couldn't confirm stays null and marks the file `partial`.

Neither one marks a fact `verified`. Only a person does.

## Reviewing a fact

1. Open the `source` and confirm the page still says what `value` and `note` claim.
2. If it does, change `status` to `"verified"` and update `retrieved`.
3. If it doesn't, fix `value` and `note`, update `retrieved`, and leave `status` as `"draft"` for a second look.

## Review these first

All 258 facts are drafts. Research agents wrote the service files on 2026-09-15 and flagged these:

- **Render and Railway `free_plan_commercial_use: false`** was inferred ("not for production", "we recommend Pro"), not taken from an explicit ban.
- **Render `first_paid_usd_month` ($7)** came from third-party trackers because the pricing page wouldn't load for the agent.
- **Lemon Squeezy** relies on secondary sources (its site blocked automated reads) and is in maintenance mode after the Stripe acquisition.
- **Google Gemini `free_plan_covers`** is null because Google doesn't publish fixed free limits, which is why it's `partial`.
- **Fly.io** has no free plan and no monthly plan since 2024; the null price is intentional.
- **Supabase key names**: current quickstarts use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The storage file was corrected to match.
- **MongoDB Atlas `mobile_sdk: false`**: Atlas Device SDK reached end of life on 2025-09-30.
- **Supabase Auth `builtin_email_production_ready: false`**: its built-in email is capped at a few messages an hour and marked not for production.
- **Amazon SES and SendGrid `free_plan_covers: "none"`**: SES's free tier is now time-limited for new accounts, and SendGrid's permanent free plan was replaced by a trial. SES also starts in a sandbox that can only email verified addresses.
- **Postmark's free plan** is 100 emails a month, meant for testing.
- **Upstash QStash `long_running: false`**: it calls your own endpoint, so your host's request time limit still applies, unlike Inngest and Trigger.dev.
- **Expo's free plan** caps builds per month and blocks further builds instead of charging.
- **App store fees in `mobile-app-store-fees`**: $99 a year for the Apple Developer Program and a one-time $25 for Google Play, with sources in the rule.

The framework files (`nextjs`, `react-vite`, `sveltekit`) and `sqlite-file` were written by Claude from each project's docs; their links were checked and all resolve, but the facts are still drafts.

## What the checks enforce

`src/engine/data.test.ts` runs on every change:

- every file parses against the schemas
- every fact key and value is valid, and full options have every required fact
- every rule's needs and facts exist, and product rules point at real options in the right slots
- every option has a logo entry, and its file exists in `public/logos/`
- no em dashes anywhere in the data
- every pair of fully researched options gets a real verdict under every rule, with all needs on
- every slot has at least one fully researched option
- a typical plan with every need switched on comes back with nothing blocked
