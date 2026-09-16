# Decisions

This is the record of the grilling session on 2026-09-14 and 2026-09-15 that turned the "Vibe Architect" brainstorm (`Documents/ChatGPT/Project brainstorm/BRIEF.md` and `DESIGN.md`) into WhyStack.

Each decision says who made it: **Michael** (his answer) or **Claude, accepted** (a recommendation Michael took with "do your recommendations for the rest"). The "In your words" lines are left blank on purpose. Michael's rule is that he writes the first draft of every project decision, and a decision isn't his to defend in an interview until he can explain it without notes.

---

## 1. What WhyStack is for

**Michael:** It's for everyone. The goal is to make people their own project manager: understand the components and the tradeoffs, have real research behind why you'd pick one host or backend over another, run spec-driven development for real, and set up the AI build process instead of just telling the agent to go.

**In your words:**

## 2. The first user

**Michael:** Beginners first. Claude had recommended learning builders (students and junior devs who already use Claude Code). Experienced users come second, and they get two things from the same engine: side-by-side comparisons, and reasoning they can use when they propose a design to someone.

Michael's key idea from this answer: a **full logic** of what works with what under which conditions (which language pairs with which framework, and so on), so the product guides instead of guessing.

**In your words:**

## 3. Where the logic comes from

**Michael:** Hybrid. Curated rules are the source of truth. AI has three jobs around them: turn a beginner's plain answers into facts the rules can check, explain results in plain language, and draft new rules from research into a review queue. A draft doesn't count until it's approved.

**In your words:**

## 4. First release scope

**Michael:** Web apps first, but set up for mobile. A drag-and-drop canvas with as many options as possible, a planner in a side panel, and connection logic that works and makes sense.

How "set up for mobile" is built: services record mobile facts from day one (`mobile_sdk`), and "Phone app later" is already a question that changes the plan.

**In your words:**

## 5. Rule style

**Michael:** Both capability rules (written once about traits, like "no permanent disk") and product rules (exact pairs, like Clerk with Supabase).

Precedence, proposed by Claude and not objected to: capability rules are the default; product rules can add a perk, a setup step or a warning, but can never turn "doesn't work" into "works". If a capability rule blocks a pair that really works, a fact is wrong and gets fixed. Unverified options stay visible, marked "not verified yet".

**In your words:**

## 6. Canvas model

**Michael:** Slots now, a free-form diagram as the goal.

Implication, from Claude: in free-form mode every arrow still needs a type ("stores data in", "logs in with"), or the logic can't judge it. So the canvas is a graph with typed connections underneath, and slots are the beginner view on top.

**In your words:**

## 7. What a beginner walks away with

**Michael:** A spec pack plus an ordered setup checklist. WhyStack never deploys. That also settled "AI deployment process": it means setting up the build and the services, not pushing to production.

**In your words:**

## 8. Choosing among options that all work

**Michael:** Scoring decides, AI explains. Fixed weights for the beginner's one priority rank the options, close calls are flagged with what decided them, and the same scores are the comparison view for experienced users.

**In your words:**

## 9. Keeping facts true

**Michael:** Open data on GitHub, reviewed as pull requests, plus a scheduled AI checker that rereads each fact's source and opens a pull request when the page no longer matches. The accepted tradeoff is that anyone can copy the data.

**In your words:**

## 10. How the side planner asks

**Michael:** Describe, then confirm, plus a follow-up questionnaire.

Claude's rule for the follow-ups, not objected to: only ask a question if its answer could change the plan, about five at most before showing the canvas, the rest optional.

**In your words:**

## 11. Cost

**Michael:** Free-tier limits and the first price jump, from one sizing question. The design doc's 14-input cost simulator is deferred to a later expert mode.

**In your words:**

## 12. Accounts

**Claude, accepted:** Try first, sign in to save. Anyone can plan and export without an account; signing in saves plans and turns on share links. Explanations are written once per rule and reviewed like facts, so live AI is only the pre-fill and a short summary. **Not built yet:** plans live in the browser's localStorage.

**In your words:**

## 13. Name

**Claude, accepted:** WhyStack, because the "why" is the product. A quick web search found no software product with that name; the closest was WhatStack, a mobile SDK lookup app. **Open, Michael's:** a USPTO search before getting attached (the Wheelhouse trademark lesson).

## 14. Tech stack

**Claude, accepted:** a Next.js 16 web app with React Flow for the canvas, a TypeScript rules engine with no AI in it, JSON data in git validated by Zod, Vitest, and mk-ui for styling.

Why, briefly: beginners don't live in terminals, so the desktop app and embedded terminal from the brainstorm went away. The same stack already runs hub and Repro. mk-ui keeps the portfolio visually consistent.

**In your words:**

## 15. What the first build includes

**Claude, accepted:** the deterministic core first. Rules, scoring, follow-ups, cost, spec pack and the full canvas UI were built and tested first. The keyword pre-fill stays as the baseline the AI pre-fill is measured against.

---

## Round two: "make this full" (2026-09-15)

Michael asked for a repo and "as many features that I discussed" as possible. What follows was built from that request. The feature list traces back to his answers above; the design calls inside each feature were Claude's, so each still needs his own reasoning.

## 16. Three more parts: background jobs, email, phone app

**Claude, from Michael's answers 1 and 4** ("understand all the different components", "workflow automation", "setting up for mobile is good too"). The existing warnings told people to "add a job service" with nowhere to add one. Email covers receipts and password resets, and a phone app can now be added to a web plan so the mobile rules have something to check.

**In your words:**

## 17. Rules that check whether a part is filled

**Claude.** A condition can now ask whether a slot is empty instead of reading a fact. That's what lets adding a background jobs service clear "long jobs can get cut off", and adding an email service clear "login emails need an email service". Rules still read at most two slots, and plan search is still exact (tested against trying every combination).

**In your words:**

## 18. AI pre-fill has to quote its evidence

**Claude, building on Michael's answer 3.** For every yes or no, Claude must copy the exact words from the description. If those words aren't really there, the answer is thrown out and the question stays unanswered. A confident guess with invented evidence becomes "unclear" instead of a wrong answer. Without an API key, or on any error, keywords are used.

**In your words:**

## 19. Explanations only from the computed plan

**Claude, from answer 8** (scoring decides, AI explains). "Explain my plan" sends Claude a brief built from the verdicts, scores and costs, never the raw catalog, and tells it not to add anything. Without a key, a template writes the same brief in fixed sentences.

**In your words:**

## 20. Only real pairings count as perks

**Claude, fixing a bug found while testing.** Notes from capability rules used to add a small bonus. One note says "downloads cost money past the free amount", so storage that charges for downloads outscored storage that doesn't. Now only product-rule notes (two services built to work together) add a bonus, and every other note is neutral.

**In your words:**

## 21. Share links instead of accounts, for now

**Claude, toward answer 12.** Accounts need a login provider and a database of your own, which is a choice for you to make. Until then, the whole plan is compressed into the link itself, so sharing needs no server and no sign-up. Several plans are saved in the browser, and plan files move them between machines.

**In your words:**

## 22. Evals are built, the cases are yours

**Claude, following hard rule 1.** `eval:prefill` grades AI pre-fill against the keyword baseline (accuracy, yes precision and recall, opposite answers). `eval:plain-llm` counts how often a plain LLM picks a stack that breaks a rule, compared with WhyStack's plan. The grader is tested; `evals/prefill-cases.json` is empty until you write the cases.

## 23. The source checker opens pull requests

**Claude, from answer 9.** `check:sources` reads each fact's page and asks Claude whether it still says the same thing. Confirmed facts get a new date. Contradicted facts change only when the corrected value has the right type, and go back to draft. The weekly workflow opens a pull request, so a person reviews every change.

## 24. Model and cost settings

**Claude.** `claude-opus-5` at low effort, with server-side refusal fallbacks, 30 AI calls per visitor per hour by default. All four settings can be changed in `.env.local`.

---

## Round three: more tools, fuller costs, and pairing with Claude (2026-09-15)

## 25. More tools, with setup and costs

**Michael:** Include building tools like scrapers and other tools, even payments, and consider the setup instructions and costs, like using your own URL and Render's costs.

**Claude, from that:** four new parts (web scraping, domain name, analytics, error monitoring) researched from official pages, PayPal and Polar researched to full, and hosting facts for custom domains, free apps that sleep, and included traffic. Domains are billed by the year, app store accounts are yearly and one-time fees, and one subscription that covers several parts is counted once.

**In your words:**

## 26. Payment services ranked by their fee

**Claude, fixing a tie found while testing.** Once PayPal was fully researched, it tied Stripe on everything WhyStack scored and won on alphabetical order despite higher fees. Payment services are now ranked on what they keep from a typical $20 sale.

**In your words:**

## 27. Pairing with Claude, all three ways

**Michael:** All three. Claude as an advisor that asks WhyStack's rules, a shared plan Claude can change, and a project handoff for Claude Code. Claude had recommended the advisor and the handoff first, with the shared plan later.

**In your words:**

## 28. How Claude connects

**Michael:** Both. The running app serves MCP over HTTP for pairing, and exported projects start the server as a command, so they work when WhyStack isn't running.

**In your words:**

## 29. Claude's changes apply like any product's MCP

**Michael:** Apply them like any other product's MCP, and the results should be seen on the platform. Built as: changes save immediately, appear on the canvas within about two seconds with a toast and Claude's reason in the Claude tab, and Undo reverses them. Checks, comparisons and cost estimates show in the Claude tab too.

**In your words:**

## 30. What exporting writes for Claude Code

**Michael:** Everything recommended (the plan file, the MCP config, rules for Claude, and letting Claude update the plan), plus an agentic coding structure with agents to run. Built as: `TASKS.md`, a `build-<part>` agent for every part, `stack-guard`, `setup-guide` and `spec-reviewer` agents, `/next-step` and `/check-stack` skills, and settings that allow WhyStack's tools. See `docs/MCP.md`.

**In your words:**

## 31. The offline server runs from WhyStack's folder

**Michael:** A path to this folder, for now. Publishing it to npm would publish the engine and data, so that waits for the public or private decision.

**In your words:**

## Round four: moving parts, wiring and local folders (2026-09-15)

## 32. Parts move, and the canvas remembers

**Michael:** Make the components movable, like n8n. Built as: any part can be dragged anywhere, the layout is saved with the plan in the browser, and "Tidy up" puts everything back on WhyStack's ellipse. Moving is not undoable, so Undo stays about the plan, and the layout is not in the shared plan, so Claude can't rearrange your canvas.

**In your words:**

## 33. A connection carries its environment variables

**Michael:** Connections like n8n, and semi-prepare setting up the environment variables. Built as: every line from the app to a service carries the variable names your code reads to reach it, the line to your host carries every variable in the plan, and clicking a line shows each name, the step that gives you its value, its docs link, and whether the browser can read it. Claude sees the same through `setup_steps` and `get_plan`.

An option with setup steps but no variable recorded says so, instead of claiming it needs none. Twelve researched options are in that state; they are listed in docs/DATA.md.

**In your words:**

## 34. Swapping a part happens on the canvas

**Michael:** Be able to sub it out. Built as: "Swap" on any part lists the other options that fit it, and picking one places it. The scores, the comparison table and the side-by-side dialog stay in Details, because they cost a full re-evaluation of the plan for each option.

**In your words:**

## 35. WhyStack writes the project into a folder on this computer

**Michael:** Tie this locally. Built as: the export dialog writes the same files straight into a folder, plus `.env.local` with names and no values, and gives you the `cd ... && claude` line. The rules: only inside your home folder, never WhyStack's own folder, no hidden or system folders, nothing replaced unless you tick the box, and an existing `.env.local` is never touched. WhyStack has no copy of any value, so it can only ever write names.

**In your words:**

## Round five: editing that works in a small window, notes, and help from Claude (2026-09-16)

## 36. The canvas gets the screen in a narrow window

**Michael:** Make the rendering for editing work well. What was wrong: in the 683px browser pane the canvas started three screens down the page and was 402px tall, with Details below it. Built as: below 1100px, a Plan and Canvas switch, a canvas that fills the screen, the side panel as a sheet that slides up when something is picked, one row of plan numbers, lines that follow a card while it's dragged, labels you can click, and menus that close when you click elsewhere. Wide windows are unchanged.

**In your words:**

## 37. Notes on every part and the line to it

**Michael:** Add more information about connections, like notes. Built as: one note per part, saved with the plan, shown as a dot on the line and a chip on the card, flagged when it was written for a service that has since been swapped, and written into SPEC.md, the prompt and that part's build agent.

**In your words:**

## 38. Claude helps inside the plan, and still never decides

**Michael:** Have AI help and edit those parts, and be able to talk more about it. Built as: a conversation on each part. Claude answers from a brief WhyStack computes for that part, and can suggest a note or a switch; a switch can only name an option the rules passed, and the page shows the rules' verdict for it. Nothing applies until accepted, as one undoable step. Without an API key, WhyStack answers the common questions from its facts and drafts notes itself. Claude Code can read and write notes through pairing.

**In your words:**

## 39. Conversations stay in the browser; notes travel

**Michael:** (Claude's call, for review.) Notes are the outcome worth keeping, so they go in share links, plan files, exports and pairing. Conversations are working notes, kept per plan in this browser only, capped at 30 turns a part, and each question is sent as one request with the earlier turns as data.

**In your words:**

---

## Still open

- **The interviewer question from Q1**, which was skipped: after a three-minute demo, what should an interviewer believe about you? Michael's to write.
- **Definition of done for the first release.** Claude's proposal, not yet agreed:
  1. A beginner goes from a description to an exported spec pack in under ten minutes, without help.
  2. Every fact on the fully researched options has been reviewed by Michael (status `verified`).
  3. AI pre-fill beats the keyword baseline on Michael's eval set, with the number published.
  4. A second eval: how often a plain LLM recommends a stack that breaks a rule, compared with the rule-grounded plan.
  5. Public repo, CI green, data checks passing.
- **The eval set.** App descriptions with known right answers. Michael writes every case.
- **Accounts.** Which login provider and database WhyStack itself should use, if plans should sync across devices.
- **Public or private repo.** The repo was created private.
- **Publishing the MCP server to npm**, so exported projects work on other machines. Waits for public or private.
- **Timing.** The Wheelhouse friends beta was planned for 2026-09-17.

## What changed from the brainstorm design

| Brainstorm (Vibe Architect) | WhyStack |
|---|---|
| Solo founders and startup teams | Beginners first, experienced users second |
| Desktop app with an embedded terminal | Web app, no terminal |
| Electron, node-pty, SQLite | Next.js, JSON in git, localStorage and share links for now |
| Free-form architecture graph | Slots now (14 parts), typed free-form graph later |
| MCP server, change center, plan-vs-code checks, Figma | MCP server built for pairing and project handoff; the rest later or dropped |
| 14-input cost simulator | Free-tier limits and first price jump, at every audience size |
| Claude Code integration at the center | Agent-neutral spec pack for any builder |
| AI as the planning assistant | AI reads and explains; rules decide; people review facts |
