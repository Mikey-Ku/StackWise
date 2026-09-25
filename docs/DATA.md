# The data

Everything StackWise knows is in `data/`. Changes go through pull requests, and `pnpm check:data` must pass. As of 2026-09-24: 16 parts, 101 options (80 fully researched), 557 facts, 45 capability rules, 6 product rules, 17 questions, and 50 glossary terms.

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
- **Null.** For `first_paid_usd_month`, null means "no monthly plan" on a `full` option. Everywhere else, null means unverified. Facts of type `number` (a domain's prices, a payment service's card fee) can't be null on a `full` option.
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

## Costs beyond the monthly plan

- **Domains** are billed yearly from `com_first_year_usd` and `com_renewal_usd`. They're ranked on those two prices, since no domain is free.
- **Payment services** are ranked on the fee they keep from a typical $20 sale (`card_fee_percent` and `card_fee_fixed_usd`), since none has a monthly plan.
- **`planning.json` `fees`** are costs that come with a part whatever fills it, like the Apple Developer Program for a phone app. Each has a price, `year` or `once`, and a source.
- **`planning.json` `shared_plans`** lists providers whose one paid plan covers every part they fill (Supabase's database, login and storage), so the plan is counted once. The same option in two parts (PostHog for analytics and error monitoring) is always counted once.

## Stats

The numbers on cards, canvas parts, Details and Compare come from `src/engine/stats.ts`, read from the facts above. Nothing new is stored. An unverified fact shows as "Not verified" and never as a guess, and cards skip a stat the cost already implies.

## Teaching content: `data/learn.json`

`slots` has one entry per part (`what`, `why`, `choosing`, `watch_for`, `terms`), and `terms` is the glossary (`term`, `plain`, `matters`). Every term a part mentions must exist. It is written to stay true: no prices, limits or dates.

## Adding or refreshing facts with Claude

- `pnpm check:sources` rereads the page behind each fact and reports what's still supported, what changed and what's unclear. `--apply` edits the data: confirmed facts get today's date, contradicted facts get the corrected value only when it has the right type, and go back to `draft`. `--option <id>` and `--limit <pages>` narrow it. The weekly workflow in `.github/workflows/source-check.yml` does this and opens a pull request; it needs the `ANTHROPIC_API_KEY` secret and "Allow GitHub Actions to create and approve pull requests" in the repo settings.
- `pnpm draft:option -- --id <id> --name "<Name>" --slot <slot> --website <url>` researches a service with web search and writes a draft file. Anything it couldn't confirm stays null and marks the file `partial`.
- `pnpm check:options -- --id <id>[,<id>]` checks just the files you're writing (schema, fact types, full coverage, em dashes) without the cross-file checks, so several people can write options at once.

Neither one marks a fact `verified`. Only a person does.

## Reviewing a fact

The review page does this one fact at a time: run `pnpm dev`, open `/review` (or "Review facts" in the plan menu), and work down the list with J and K, Y for "Matches the source" and N for "Something's off".

- **What comes first.** The facts the default plans rest on: StackWise plans every template and the Pitchwell example, and for each option they end up with it lists the facts the rules and the ranking read (the part's `required_facts` and the score's criteria). The facts used by the most defaults are at the top. "All" adds every other fact of a fully researched option. The Overview says how many facts behind the open plan are reviewed.
- **"Matches the source"** sets `status` to `"verified"` and adds `"reviewed": "<today>"` under it. Nothing else in the file changes, so the diff is those two lines.
- **"Something's off"** leaves the fact a draft (a verified one goes back to draft) and saves your note in `.stackwise/review-flags.json`, which is gitignored. Fix `value` and `note`, update `retrieved`, then confirm it on the page, which clears the flag.
- `pnpm check:sources --apply` drops `reviewed` from any fact whose value it changes, since the review was of the old value.
- The page and `/api/review` only answer this computer, and don't exist when `STACKWISE_HOSTED=1`.

By hand it's the same: open the `source`, and if it still says what `value` and `note` claim, change `status` to `"verified"` and add `reviewed` with the date.

## Review these first

All facts are drafts. Research agents wrote the service files on 2026-09-15 and flagged these:

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

Flagged in the second research round (scraping, domains, analytics, error monitoring, hosting costs, PayPal and Polar):

- **Render's free plan changed.** Render's 2026 pricing update cut the free workspace's bandwidth from 100 GB to 5 GB a month, so `free_plan_covers` moved from `up_to_1000` to `up_to_100`. Starter compute is still $7/month; more bandwidth needs the $25 Pro workspace.
- **Railway `custom_domain_free: false`**: the pricing page says the Free plan gets 0 custom domains, while a forum moderator said 1.
- **Vercel, Netlify and Cloudflare `free_plan_sleeps: false`**: request-based functions have cold starts but the app itself never pauses; Fly.io and Cloudflare `custom_domain_free` were inferred from the absence of any domain fee.
- **Polar `first_paid_usd_month: null`**: its paid tiers only lower the fee and are optional. Polar, Lemon Squeezy and Paddle all list 5% + 50 cents.
- **Scraping free plans** are credits, mapped to audience sizes by judgment: Firecrawl (1,000 credits a month), Apify ($5 of monthly credit, 1,000 to 25,000 pages), ScrapingBee (a one-time 1,000-credit trial, not stated as one-time on the page).
- **Browserbase `ai_ready_output: true`** comes from its separate Fetch API, not the hosted browser itself, and its price per 1,000 pages uses Browserbase's own "100 hours is roughly 3,000 page tasks".
- **Jina Reader is `partial`**: its Reader price is behind a login.
- **Vercel Domains is `partial`**: its prices only show in a live search that blocked automated use.
- **Namecheap's $11.28 first year** is a standing sale (list $14.98); Cloudflare's community docs mention a wholesale price increase on 2026-11-01.
- **Monitoring free plans**: Sentry, Rollbar and Honeybadger allow 5,000 errors a month; LogRocket's pricing page now shows only a 14-day trial; Sentry's $29 monthly price was corroborated by trackers because the page only rendered the yearly price; Rollbar's $9 came from its official pricing-for-agents page.
- **Google Analytics `cookies: required`** reflects the standard gtag.js setup; Google's docs say the libraries can run without cookies.

Found while building the wiring view on 2026-09-15:

- **Twelve researched options have setup steps but name no environment variable**, so the canvas can only say "no environment variable is written down" for them: Cloudflare R2, Crawlee, Expo, Fathom Analytics, Firebase Auth, Firestore, Flutter, Google Analytics 4, LogRocket, Native (Swift and Kotlin), Plausible and Umami Cloud. Firebase and R2 certainly need keys, and the analytics services need a site or measurement id. The names belong in the `env` array of the setup step that hands you the value, taken from the official quickstart. Hosts, frameworks and domain registrars are different: they hold your variables or need none, so an empty list is right for them.
- **Honeybadger `NEXT_PUBLIC_HONEYBADGER_API_KEY`** is public by design (a write-only project key), as Honeybadger's Next.js guide names it.

The framework files (`nextjs`, `react-vite`, `sveltekit`) and `sqlite-file` were written by Claude from each project's docs; their links were checked and all resolve, but the facts are still drafts.

## What the checks enforce

`src/engine/data.test.ts` runs on every change:

- every file parses against the schemas
- every fact key and value is valid, and full options have every required fact
- every rule's needs and facts exist, and product rules point at real options in the right slots
- every option has a logo entry, and its file exists in `public/logos/`
- a plan with every question answered yes is found in well under 1.5 seconds
- no em dashes anywhere in the data
- every pair of fully researched options gets a real verdict under every rule, with all needs on
- every slot has at least one fully researched option
- a typical plan with every need switched on comes back with nothing blocked
