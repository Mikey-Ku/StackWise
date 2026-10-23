# A two-minute demo

One run through StackWise for a video, a class or an interview. It works with no API key and no agent connected; the steps that need Claude Code say so.

**Before you start:** open StackWise (the Mac app, or `pnpm dev` and http://localhost:4310), press **New project** on the Projects page, and leave the chat pane open on the left: it narrates every change as you go.

## 0:00 The problem (15 seconds)

"People who build apps with AI builders pick their stack from whatever the chatbot says. The chatbot doesn't know that a SQLite file on Vercel loses its data on every deploy, or that Stripe leaves sales tax to you. StackWise checks every connection against facts with a source and a date."

## 0:15 Describe (20 seconds)

1. Type the name **Fade** and this description:

   > A booking app for my barber shop. Customers log in, pick a time, pay a deposit, and get a text reminder the day before. I want to see how many bookings we get each week.

2. Press **Read my description**. Point at the quoted words under each guess ("You wrote 'pay', so: yes"). Every guess shows the words it came from, and you confirm each one.
3. Press **Looks right, build my plan**.

## 0:35 Read the plan (25 seconds)

1. The canvas: the app in the middle, a card per part, a line per connection with a check.
2. The toolbar at the top: monthly cost and how many problems. The chat pane on the left has already written up what the plan did with each answer.
3. Click **Stripe**. Details shows the stats at this size, the fee per sale, and the check "You handle sales tax", with its source.

## 1:00 Break it on purpose (20 seconds)

1. Right-click **Firestore**, **Switch to**, **SQLite file**. Hosting quietly moves from Netlify to Fly.io: SQLite keeps its data in a file, so StackWise re-plans the host to one with a permanent disk.
2. Right-click **Fly.io**, **Switch to**, **Netlify**, to force the bad pairing. The line between them turns red: "Your data would disappear". Netlify gives the app no permanent disk, so anything people save is lost on the next deploy. The fix and the sources are in Details.
3. Press Cmd+Z twice. It's back. Each step is in the chat as a line from you and an explanation from the facts.

"No AI decided that. A rule read two facts, the host's disk and where the database keeps its data, each with a source, and the search picked around it until I forced it."

## 1:20 Ask (15 seconds)

Right-click **Stripe**, **Ask about this**, and press **Which keys does it need?** in the chat pane. With the provider set to StackWise (no AI), the answer comes from StackWise's own facts: the variable names, where each value comes from, and which one the browser can read. Switch the provider bubble to Claude to have a model explain the same brief.

## 1:35 Hand it to a builder (25 seconds)

1. Right-click the canvas, **Copy the build plan**: every part and line as a task, in an order where each only needs the ones above it.
2. Press **Export**. The zip has SPEC.md, SETUP.md, TASKS.md, DECISIONS.md, `.env.example`, and for Claude Code an agent per part and the MCP connection.
3. With Claude Code paired (`/mcp__stackwise__pair`): right-click **Stripe**, **Build this with Claude Code**. The task arrives in the terminal with its note, its variables and when it's done, and Claude checks any stack change with StackWise before making it.

## 2:00 Close

"The AI explains and builds. The rules decide what works, from facts a person can check on the review page."

## Longer version

On the **Projects** page, open the Pitchwell example: a dozen parts, a note on every one, and one warning to walk through. Turn on **Advanced tools** (the wrench in the dock) to show a second service in one part and a line drawn between two parts. Settings, Models shows how a key and a model are set per provider; Settings, Agents connects Claude Code in one press.
