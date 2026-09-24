import type { Answer, Selection } from "@/engine";

/**
 * Starting points by kind of app, for someone who doesn't know what to type yet. Each one answers
 * the questions a typical app of that kind would, as guesses the person confirms like any other,
 * and some pick the phone app toolkit. Demo content, not eval cases.
 */
export interface Template {
  id: string;
  label: string;
  blurb: string;
  icon: "web" | "phone" | "phones" | "sparkle" | "cart" | "tool";
  description: string;
  answers: Record<string, Answer>;
  pinned?: Selection;
}

export const TEMPLATES: Template[] = [
  {
    id: "web",
    label: "Web app",
    blurb: "Accounts, saved data, your own address",
    icon: "web",
    description: "A web app where people sign up, log in and save their own things, on its own web address.",
    answers: { saves_data: "yes", login: "yes", own_domain: "yes" },
  },
  {
    id: "ios",
    label: "iOS app",
    blurb: "An iPhone app with accounts",
    icon: "phone",
    description: "An iPhone app on the App Store where people log in and save their own things.",
    answers: { saves_data: "yes", login: "yes", might_go_mobile: "yes" },
    pinned: { mobile: "native-mobile" },
  },
  {
    id: "android",
    label: "Android app",
    blurb: "An Android app with accounts",
    icon: "phone",
    description: "An Android app on Google Play where people log in and save their own things.",
    answers: { saves_data: "yes", login: "yes", might_go_mobile: "yes" },
    pinned: { mobile: "native-mobile" },
  },
  {
    id: "mobile",
    label: "iOS + Android",
    blurb: "One codebase for both phones",
    icon: "phones",
    description: "A phone app for iPhone and Android from one codebase, where people log in and save their own things.",
    answers: { saves_data: "yes", login: "yes", might_go_mobile: "yes" },
    pinned: { mobile: "expo" },
  },
  {
    id: "ai",
    label: "AI app",
    blurb: "A chatbot or generator",
    icon: "sparkle",
    description: "An AI app where people log in, chat with an assistant or generate text and images, and keep their history.",
    answers: { saves_data: "yes", login: "yes", ai_features: "yes", users_pay: "not_sure" },
  },
  {
    id: "saas",
    label: "AI SaaS",
    blurb: "Subscriptions, AI, background jobs",
    icon: "sparkle",
    description: "A subscription web app where people log in, upload files and generate work with AI. Long jobs run in the background, it sends emails on a schedule, and it lives on its own web address with analytics and error alerts.",
    answers: { saves_data: "yes", login: "yes", users_pay: "yes", uploads: "yes", ai_features: "yes", long_jobs: "yes", scheduled_tasks: "yes", sends_email: "yes", own_domain: "yes", tracks_usage: "yes", error_alerts: "yes" },
  },
  {
    id: "store",
    label: "Online store",
    blurb: "Products, checkout, receipts",
    icon: "cart",
    description: "An online store with product photos, a checkout that takes card payments, and email receipts, on its own web address.",
    answers: { saves_data: "yes", users_pay: "yes", uploads: "yes", sends_email: "yes", own_domain: "yes" },
  },
  {
    id: "internal",
    label: "Internal tool",
    blurb: "For a small team, behind a login",
    icon: "tool",
    description: "An internal tool for a small team: everyone logs in, adds and edits records, and sees them in one place.",
    answers: { saves_data: "yes", login: "yes", users_pay: "no", own_domain: "no" },
  },
];
