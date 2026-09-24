import type { SharedPlan } from "@/engine";

/**
 * Finished plans to walk someone through StackWise, opened from the plans menu as a new plan.
 * Demo content, not eval cases: the answers and notes are a made-up founder's, and the rules pick
 * the parts like they would for anyone.
 */
export interface Demo {
  id: string;
  label: string;
  plan: SharedPlan;
}

const DEMO_DATE = "2026-09-23T12:00:00.000Z";
const note = (text: string) => ({ text, updatedAt: DEMO_DATE, by: "you" as const });

export const DEMOS: Demo[] = [
  {
    id: "pitchwell",
    label: "Paid AI app with subscriptions",
    plan: {
      v: 1,
      appName: "Pitchwell",
      description:
        "Pitchwell writes client proposals for freelancers. People sign up with Google or email, upload their past proposals and brand files, and Pitchwell drafts new proposals in their voice with AI. The free plan includes 3 drafts a month; Pro is $19 a month with unlimited drafts. Long drafts are written in the background and emailed when ready, and every Monday people get a digest of which proposals clients opened. It lives at pitchwell.app, posts to the team's Slack when a proposal is accepted, and we want to see signups and hear about errors before users do.",
      features: [
        "Sign up with Google or an email link",
        "Upload past proposals (PDF, Word) and a logo",
        "Draft a proposal with AI from a short brief, in the user's voice",
        "Free plan with 3 drafts a month, Pro subscription at $19 a month",
        "Cancel or change plan from a billing page",
        "Long drafts run in the background and arrive by email",
        "Monday digest of which proposals clients opened",
        "Slack message when a client accepts",
        "Signup and usage analytics, error alerts",
      ].join("\n"),
      answers: {
        saves_data: "yes",
        login: "yes",
        users_pay: "yes",
        uploads: "yes",
        large_uploads: "no",
        live_updates: "no",
        long_jobs: "yes",
        scheduled_tasks: "yes",
        sends_email: "yes",
        own_domain: "yes",
        ai_features: "yes",
        scrapes_sites: "no",
        might_go_mobile: "not_sure",
        tracks_usage: "yes",
        error_alerts: "yes",
        automations: "yes",
        outside_data: "no",
      },
      size: "up_to_1000",
      priority: "launch_fast",
      builderId: "claude-code",
      pinned: {},
      notes: {
        framework: note(
          "Pages: landing, pricing, sign in, dashboard (list of proposals), editor (brief on the left, draft streaming in on the right), billing, settings. Server-only code holds the AI key, the payment secret and the webhook handlers.",
        ),
        hosting: note(
          "Runs the site and the API routes. Every environment variable in the checklist goes here too. Preview deploys for each branch so I can test pricing changes before they go live.",
        ),
        domain: note("pitchwell.app for the site, app.pitchwell.app for the dashboard. The email service needs three DNS records here (SPF, DKIM, DMARC) before it can send as hello@pitchwell.app."),
        database: note(
          "Tables: users, workspaces, proposals (brief, draft, status: draft, sent, opened, accepted), writing_samples, usage (drafts this month), subscriptions (mirrored from payments). Each user only reads their own rows.",
        ),
        login: note("Google sign-in and email links. No passwords to reset. A new account starts on Free with 3 drafts."),
        files: note("Past proposals (PDF, Word) and logos, under 10 MB each, in a private bucket. Only the owner can read them; the AI step reads them on the server with a short-lived link."),
        payments: note(
          "Free: 3 drafts a month. Pro: $19 a month, unlimited. Checkout for upgrades, a customer portal to cancel or change card, and a webhook that turns Pro on and off. The page never decides who is Pro; the webhook does.",
        ),
        ai: note(
          "One call per draft: the brief, 3 of the user's past proposals as style samples, and a proposal template. The draft streams in. Long ones (over 4 pages) go to a background job instead. Free accounts stop at 3 a month, counted in the usage table.",
        ),
        jobs: note("Two jobs: 'write long draft' (retries twice, then emails the user that it failed) and 'Monday digest' at 8am in each user's time zone, listing proposals clients opened that week."),
        email: note("Four emails: the sign-in link, 'your draft is ready', the Monday digest, and payment receipts. Sent from hello@pitchwell.app once the domain is verified, so they don't land in spam."),
        analytics: note(
          "Events: signed_up, brief_submitted, draft_generated (pages, seconds), draft_exported, upgrade_clicked, subscribed, canceled. One funnel: sign up, first draft, export, subscribe. A weekly chart of drafts per active user, and a session replay on the pricing page to see where people hesitate.",
        ),
        monitoring: note(
          "Alerts in Slack when the AI call fails more than 5 times in 10 minutes, when the payment webhook errors even once, or when a background job fails its last retry. Each error carries the user id and proposal id, never the proposal text.",
        ),
        automations: note("When a proposal is marked accepted: post 'Pitchwell win: <client>, <amount>' to the team's Slack and add a row to the sales spreadsheet. Nothing here touches billing."),
      },
    },
  },
];
