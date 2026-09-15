# Pairing with Claude: the WhyStack MCP server

WhyStack runs an [MCP](https://modelcontextprotocol.io) server so Claude can use the planner's rules instead of guessing. Claude calls the same engine the canvas uses: it can check any stack, compare options, get costs and setup steps, and read and change the plan you share. Everything Claude does shows up in WhyStack's Claude tab, and every change it makes can be undone.

It works two ways:

| | Pairing in WhyStack | An exported project |
|---|---|---|
| Transport | HTTP, served by the running app at `/api/mcp` | A command Claude Code starts: `pnpm --silent --dir <WhyStack> mcp` |
| Connect | `claude mcp add --transport http --scope user whystack http://localhost:4310/api/mcp` | Nothing to do: the project's `.mcp.json` has it |
| Plan it works on | The plan you have open, once "Pair with Claude" is on | The project's `whystack.plan.json` |
| Needs WhyStack running | Yes | No. Changes reach the WhyStack tab whenever it's open |

## Pair on a plan

1. Run `pnpm dev` and open http://localhost:4310.
2. Click **Pair with Claude**, turn on **Share the plan you have open with Claude**, and copy the command.
3. Run the command once. `--scope user` makes WhyStack available in every Claude Code session.
4. In Claude Code, ask something like "check my WhyStack plan and fix the warnings" or "add web scraping to my plan and compare the options".

Claude's changes appear on the canvas within about two seconds, with a toast and its reason in the Claude tab. Undo reverses them like any other change. Switch plans and Claude follows; turn sharing off and Claude can still check stacks but can't see your plans.

## Hand a project to Claude Code

**Export project** downloads a zip. With Claude Code as the builder it holds:

- `SPEC.md`, `SETUP.md`, `DECISIONS.md`: the plan, its accounts and keys, and why each part was picked.
- `TASKS.md`: the build, part by part, with the agent for each task and when it's done.
- `whystack.plan.json`: the plan itself. The MCP server keeps it in step with WhyStack.
- `CLAUDE.md`: the stack and its rules, plus how to work with WhyStack: check every service change with `check_stack`, record it with `update_plan`, build with `/next-step`.
- `.mcp.json`: starts WhyStack's MCP server from WhyStack's folder on this machine.
- `.claude/settings.json`: allows the WhyStack tools (`mcp__whystack`) without asking each time.
- `.claude/agents/`: `stack-guard` (checks and records any stack change), `setup-guide` (walks through SETUP.md, never handles secret values), `spec-reviewer` (reviews work before a task is checked off), and a `build-<part>` agent for each part of the stack with its setup, rules and problems.
- `.claude/skills/`: `/next-step` (does the next task with its agent, reviews it, checks it off) and `/check-stack`.

Unzip it as a new project folder and run `claude` there. Claude Code asks once whether to trust the project's MCP server.

To bring a project's plan back into WhyStack in another browser, use **Import plan file** on its `whystack.plan.json`. It keeps the plan's id, so changes Claude makes in that project keep showing up.

Other builders get the spec, setup, tasks, decisions and plan file, without the `.claude` folder.

## Tools

| Tool | What it does | Changes anything |
|---|---|---|
| `list_parts` | Every part of an app, what it's for, and the question ids that add it | No |
| `search_options` | Options by part or words, with quick stats at a size | No |
| `get_option` | An option's facts with notes, sources and dates, setup steps and builder rules | No |
| `check_stack` | Every verdict for a set of choices, with reasons, fixes, sources and cost | No |
| `recommend_stack` | WhyStack's best stack for answers, size and priority | No |
| `compare_options` | Two to five options for one part, each swapped into the stack | No |
| `estimate_costs` | Monthly, yearly and one-time cost, part by part and at every size | No |
| `setup_steps` | Ordered setup steps with exact environment variable names | No |
| `get_plan` | The shared plan: stack, checks, close calls, costs, questions | No |
| `update_plan` | Change answers, parts, size, priority, builder or text, with a note saying why | Yes |
| `export_project` | Every project file above, for Claude to write | No |

`update_plan` goes through the same validation as the planner (`applyPlanUpdate` in `src/engine/planops.ts`): unknown question ids, unknown options, or an option in the wrong part are refused and nothing is saved.

## How it works

- `src/mcp/server.ts` registers the tools on an `McpServer` from `@modelcontextprotocol/sdk`. Every tool calls the engine; none of them decides compatibility.
- `src/app/api/mcp/route.ts` serves it over Streamable HTTP, stateless: each request gets a fresh server.
- `src/mcp/stdio.ts` serves it over stdio for projects. Claude Code sets `CLAUDE_PROJECT_DIR` to the project folder, which is how the server finds `whystack.plan.json`. Only JSON-RPC may be written to stdout.
- Shared plans live in `.whystack/` in WhyStack's folder (gitignored): one JSON file per plan with its version, who changed it last, and an activity log, plus `active.json` for the plan being shared. `src/mcp/registry.ts` writes them atomically so the app and the command can both use them.
- The WhyStack tab (`src/components/usePairing.ts`) shares the open plan with `PUT /api/pair` and asks `GET /api/pair?since=` every 1.5 seconds for anything Claude changed or did. A Claude change newer than the tab's copy is applied as an undoable step. If the tab and Claude change the plan at the same moment, the tab takes Claude's version first.
- An exported project's plan file and WhyStack's copy sync on every tool call: whichever changed last wins.

## Security

- `/api/mcp` and `/api/pair` only answer requests addressed to `localhost`, `127.0.0.1` or `[::1]`, and refuse requests from pages on other sites (their `Origin` header). That stops DNS rebinding and a website posting to your local server. See `src/mcp/local.ts`.
- `WHYSTACK_PAIRING=off` turns both off, for example on a public deployment. A hosted WhyStack would need accounts before pairing could be on.
- Plans never leave the computer through these routes. When Claude calls a tool, the result goes to Claude like any other tool result.

## Troubleshooting

- **"No plan is shared yet"**: turn on Pair with Claude in WhyStack for the plan.
- **Claude Code doesn't list WhyStack's tools**: run `claude mcp list`. For pairing, WhyStack must be running on port 4310. For a project, check that `.mcp.json` points at WhyStack's folder and that `pnpm` is on your PATH.
- **Try the command yourself**: `CLAUDE_PROJECT_DIR=/path/to/project pnpm --silent --dir /path/to/whystack mcp` should print "WhyStack MCP server running" to stderr and wait for input.
- **Start over**: stop the app and delete `.whystack/`. Plans in the browser are untouched.
