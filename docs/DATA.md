# The data

Everything WhyStack knows is in `data/`. Changes go through pull requests, and `pnpm check:data` must pass. As of 2026-09-15: 48 options (28 fully researched), 199 facts, 19 capability rules, 6 product rules, 10 questions.

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
- A rule reads at most two slots, and only facts in those slots' `required_facts`.
- `needs` switch a rule on only when the beginner confirmed "yes".
- `{slot}` placeholders become option names.

**Product rules** (`data/rules/product.json`) name an exact pair. Their severity can be `blocked`, `warning` or `info`, never "works", so they can't overrule a capability rule.

## Reviewing a fact

1. Open the `source` and confirm the page still says what `value` and `note` claim.
2. If it does, change `status` to `"verified"` and update `retrieved`.
3. If it doesn't, fix `value` and `note`, update `retrieved`, and leave `status` as `"draft"` for a second look.

## Review these first

All 199 facts are drafts. Research agents wrote the service files on 2026-09-15 and flagged these:

- **Render and Railway `free_plan_commercial_use: false`** was inferred ("not for production", "we recommend Pro"), not taken from an explicit ban.
- **Render `first_paid_usd_month` ($7)** came from third-party trackers because the pricing page wouldn't load for the agent.
- **Lemon Squeezy** relies on secondary sources (its site blocked automated reads) and is in maintenance mode after the Stripe acquisition.
- **Google Gemini `free_plan_covers`** is null because Google doesn't publish fixed free limits, which is why it's `partial`.
- **Fly.io** has no free plan and no monthly plan since 2024; the null price is intentional.
- **Supabase key names**: current quickstarts use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The storage file was corrected to match.
- **MongoDB Atlas `mobile_sdk: false`**: Atlas Device SDK reached end of life on 2025-09-30.

The framework files (`nextjs`, `react-vite`, `sveltekit`) and `sqlite-file` were written by Claude from each project's docs; their links were checked and all resolve, but the facts are still drafts.

## What the checks enforce

`src/engine/data.test.ts` runs on every change:

- every file parses against the schemas
- every fact key and value is valid, and full options have every required fact
- every rule's needs and facts exist, and product rules point at real options in the right slots
- no em dashes anywhere in the data
- every pair of fully researched options gets a real verdict under every rule, with all needs on
- every slot has at least one fully researched option
- a typical plan with every need switched on comes back with nothing blocked
