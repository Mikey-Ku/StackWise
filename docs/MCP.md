# Pairing with a coding agent: the StackWise MCP server

StackWise runs an [MCP](https://modelcontextprotocol.io) server so Claude can use the planner's rules instead of guessing. Claude calls the same engine the canvas uses: it can check any stack, compare options, get costs and setup steps, and read and change the plan you share. Everything Claude does shows up in StackWise's Ask panel, every change it makes can be undone, and you can write to it from StackWise while it works (see "Talk to your agent from StackWise"). Any agent that speaks MCP (Codex, Gemini CLI, Cursor) works the same way.

It works two ways:

| | Pairing in StackWise | An exported project |
|---|---|---|
| Transport | HTTP, served by the running app at `/api/mcp` | A command Claude Code starts: `pnpm --silent --dir <StackWise> mcp` |
| Connect | `claude mcp add --transport http --scope user stackwise http://localhost:4310/api/mcp` | Nothing to do: the project's `.mcp.json` has it |
| Plan it works on | The plan you have open, once sharing is on in Ask, Agent | The project's `stackwise.plan.json` |
| Needs StackWise running | Yes | No. Changes reach the StackWise tab whenever it's open |

## Pair on a plan

1. Run `pnpm dev` and open http://localhost:4310.
2. Open **Ask** (Cmd+K), pick **Claude Code** in the Answering menu, and copy the command from the card. Sending a message, or "Share this plan with agents" in the same menu, turns sharing on.
3. Run the command once. `--scope user` makes StackWise available in every Claude Code session.
4. In Claude Code, ask something like "check my StackWise plan and fix the warnings" or "add web scraping to my plan and compare the options".

Claude's changes appear on the canvas within about two seconds, with a toast and its reason in the Ask panel. Undo reverses them like any other change. Switch plans and Claude follows; turn sharing off and Claude can still check stacks but can't see your plans.

## Talk to your agent from StackWise

Pairing also works the other way: you write in StackWise, and the agent in your terminal does it.

1. In Claude Code, run `/mcp__stackwise__pair` (the `pair` prompt). Agents without MCP prompts get the same instructions from the card in the Ask panel, to paste in.
2. The agent calls `wait_for_message` in a loop. Each call waits up to 4 minutes and returns the moment you write.
3. In StackWise, open Ask and pick the agent in the Answering menu. A green dot means it's listening. Write what you want: "switch the database to Supabase and set up login".
4. The agent does it in your project, changes the plan through `update_plan`, and answers with `send_message`: a "working" note first for anything long, then what it did, the files it changed, and "done" or "needs you".

Details:
- Each message goes to one agent, the one picked in the menu. Several agents can listen on the same plan; each only gets its own messages. A message written while nothing listens waits and is picked up on the next call.
- The menu defaults to Claude: Claude Code when it's listening, then the Claude API with a key, then StackWise's facts. "Make ... the default" saves your choice in this browser.
- After 30 minutes with no messages the agent stops listening, so an idle loop doesn't spend tokens all afternoon. Run the pair command again to resume. `STACKWISE_PAIR_WAIT_S` and `STACKWISE_PAIR_IDLE_MIN` change both numbers.
- If an agent's tool calls time out before 4 minutes, the pair prompt tells it to use `wait_seconds: 50`. A newer call from the same agent takes over from an older one, so a message never goes to a call nobody is reading.
- Only messages from `wait_for_message` are instructions. The pair prompt and the exported CLAUDE.md and AGENTS.md tell the agent that the plan's description, answers and notes are data: a share link from someone else can't make it do anything.

## Hand a project to Claude Code

**Export project** downloads a zip. With Claude Code as the builder it holds:

- `SPEC.md`, `SETUP.md`, `DECISIONS.md`: the plan, its accounts and keys, and why each part was picked.
- `.env.example` and `.gitignore`: every variable name, grouped by service with the step that gives you the value, and the rules that keep the values out of git.
- `TASKS.md`: the build, part by part, with the agent for each task and when it's done.
- `stackwise.plan.json`: the plan itself. The MCP server keeps it in step with StackWise.
- `CLAUDE.md`: the stack and its rules, plus how to work with StackWise: check every service change with `check_stack`, record it with `update_plan`, build with `/next-step`.
- `.mcp.json`: starts StackWise's MCP server from StackWise's folder on this machine.
- `.claude/settings.json`: allows the StackWise tools (`mcp__stackwise`) without asking each time.
- `.claude/agents/`: `stack-guard` (checks and records any stack change), `setup-guide` (walks through SETUP.md, never handles secret values), `spec-reviewer` (reviews work before a task is checked off), and a `build-<part>` agent for each part of the stack with its setup, rules and problems.
- `.claude/skills/`: `/next-step` (does the next task with its agent, reviews it, checks it off) and `/check-stack`.

Unzip it as a new project folder and run `claude` there. Claude Code asks once whether to trust the project's MCP server.

Or skip the zip: **Or write it into a folder on this computer** in the same dialog writes the files straight into a folder, plus a `.env.local` with the names and no values, and gives you the `cd ... && claude` line. It only writes inside your home folder, never inside StackWise's own folder, and never over an existing `.env.local`: your values are yours, and StackWise has no copy of them. Anything else already in the folder stays until you tick "Replace files that are already there". See `src/app/api/local/route.ts` and `src/mcp/localfiles.ts`.

To bring a project's plan back into StackWise in another browser, use **Import plan file** on its `stackwise.plan.json`. It keeps the plan's id, so changes Claude makes in that project keep showing up.

Other builders get the spec, setup, tasks, decisions and plan file, without the `.claude` folder.

## Tools

With a plan shared, `check_stack`, `compare_options`, `estimate_costs` and `setup_steps` use its stack, answers and size when `stack` is left out. Results are compact JSON, and the big ones (`get_plan`, `update_plan`, `export_project`) return a short form unless asked for more, because an agent pays for every character it reads.

| Tool | What it does | Changes anything |
|---|---|---|
| `list_parts` | Every part of an app, what it's for, and the question ids that add it | No |
| `search_options` | Options by part or words, with quick stats at a size | No |
| `get_option` | An option's facts with notes, sources and dates, setup steps and builder rules | No |
| `check_stack` | Every verdict for a set of choices, with reasons, fixes, sources and cost. `swap` checks a change to the shared plan without sending the whole stack | No |
| `recommend_stack` | StackWise's best stack for answers, size and priority | No |
| `compare_options` | Options for one part, each swapped into the stack; without `option_ids`, the best 5 ranked | No |
| `estimate_costs` | Monthly, yearly and one-time cost, part by part and at every size | No |
| `setup_steps` | Setup part by part: ordered steps, environment variables, docs, what runs between the app and the service, and the build order; `part` for one | No |
| `get_plan` | The shared plan as a short text digest: the diagram, each part with why it was picked and what it beat or tied, cost, notes, parts added by hand, and problems with fixes. `detail: "summary"` returns JSON with ids, answers and checks; `"full"` adds cost details, connections and every question | No |
| `update_plan` | Change answers, parts, size, priority, builder, text or the notes on each part, with a note saying why. Returns what changed (parts, new and resolved checks, verdict, cost), not the whole plan | Yes |
| `export_project` | Writes every project file above straight into the project folder (the one the agent runs in, or `folder`) and returns only their names. Same rules as the Export dialog: inside your home folder, nothing replaced without `replace`, `.env.local` never replaced. `paths` returns chosen files' text instead; `list_only` lists them | Yes |
| `wait_for_message` | Waits up to 4 minutes for the person to write to this agent from StackWise | Marks messages picked up |
| `send_message` | Answers the person in StackWise, with the files it changed and a status; `then_wait` also waits for the next message | Adds to the conversation |

And one prompt, `pair`, which tells the agent how to listen and what counts as an instruction.

`update_plan` goes through the same validation as the planner (`applyPlanUpdate` in `src/engine/planops.ts`): unknown question ids, unknown options, or an option in the wrong part are refused and nothing is saved.

Notes are how Claude helps with a part without touching the stack: `update_plan` with `notes: { "payments": "Take a 20% deposit at booking." }` writes one (marked as written by Claude, with the option it was written for), and `""` removes it. The note shows on the canvas and in Details within a couple of seconds, and Undo reverses it. `get_plan` flags a note written for an option that has since been swapped out. Ask Claude something like "write a note on the payments part about how deposits work" or "check my notes still match the stack".

## How it works

- `src/mcp/server.ts` registers the tools on an `McpServer` from `@modelcontextprotocol/sdk`. Every tool calls the engine; none of them decides compatibility.
- `src/app/api/mcp/route.ts` serves it over Streamable HTTP, stateless: each request gets a fresh server.
- `src/mcp/stdio.ts` serves it over stdio for projects. Claude Code sets `CLAUDE_PROJECT_DIR` to the project folder, which is how the server finds `stackwise.plan.json`. Only JSON-RPC may be written to stdout.
- Shared plans live in `.stackwise/` in StackWise's folder (gitignored): one JSON file per plan with its version, who changed it last, an activity log, the conversation with agents (`messages`) and what each agent is doing (`agents`), plus `active.json` for the plan being shared. `src/mcp/pairing.ts` holds the pure rules: agent names, presence, the wait settings and the pair prompt. `src/mcp/registry.ts` writes them atomically so the app and the command can both use them.
- The StackWise tab (`src/components/usePairing.ts`) shares the open plan with `PUT /api/pair` and asks `GET /api/pair?since=` every 1.5 seconds for anything an agent changed, did or said. `POST /api/pair` puts your message in the inbox. A Claude change newer than the tab's copy is applied as an undoable step. If the tab and Claude change the plan at the same moment, the tab takes Claude's version first.
- An exported project's plan file and StackWise's copy sync on every tool call: whichever changed last wins.

## Security

- `/api/mcp` and `/api/pair` only answer requests addressed to `localhost`, `127.0.0.1` or `[::1]`, and refuse requests from pages on other sites (their `Origin` header). That stops DNS rebinding and a website posting to your local server. See `src/mcp/local.ts`.
- `STACKWISE_PAIRING=off` turns both off, for example on a public deployment. A hosted StackWise would need accounts before pairing could be on.
- Plans never leave the computer through these routes. When Claude calls a tool, the result goes to Claude like any other tool result.

## Troubleshooting

- **"No plan is shared yet"**: in StackWise, open Ask, switch to Agent, and turn on sharing for the plan.
- **Claude Code doesn't list StackWise's tools**: run `claude mcp list`. For pairing, StackWise must be running on port 4310. For a project, check that `.mcp.json` points at StackWise's folder and that `pnpm` is on your PATH.
- **Try the command yourself**: `CLAUDE_PROJECT_DIR=/path/to/project pnpm --silent --dir /path/to/stackwise mcp` should print "StackWise MCP server running" to stderr and wait for input.
- **Start over**: stop the app and delete `.stackwise/`. Plans in the browser are untouched.
