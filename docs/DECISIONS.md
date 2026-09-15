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

**Claude, accepted:** the deterministic core first. Rules, scoring, follow-ups, cost, spec pack and the full canvas UI are built and tested. The question pre-fill uses keywords, which becomes the baseline the AI pre-fill is measured against. The AI pre-fill, the AI fact checker and accounts come next.

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
- **Timing.** The Wheelhouse friends beta was planned for 2026-09-17.

## What changed from the brainstorm design

| Brainstorm (Vibe Architect) | WhyStack |
|---|---|
| Solo founders and startup teams | Beginners first, experienced users second |
| Desktop app with an embedded terminal | Web app, no terminal |
| Electron, node-pty, SQLite | Next.js, JSON in git, localStorage for now |
| Free-form architecture graph | Slots now, typed free-form graph later |
| MCP server, change center, plan-vs-code checks, Figma | Later expert mode, or dropped for now |
| 14-input cost simulator | Free-tier limits and first price jump |
| Claude Code integration at the center | Agent-neutral spec pack for any builder |
