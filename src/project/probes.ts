import { mask } from "./envfile";

/**
 * Live checks against the services in a plan, run on this computer with the project's own keys.
 * Each is one read-only GET that proves the key works and the service answers, plus an example
 * of what the app sends and gets back on that connection. They never change anything in the
 * service, and they never decide a verdict: the rules do that. The request shown on the page has
 * every key masked, and any key that appears in a response is masked too.
 */

export interface ProbeDef {
  /** What the check proves, in a few words. */
  title: string;
  /** Env names, in the order to try, for each placeholder in the url or headers. */
  env: Record<string, string[]>;
  url: string;
  headers?: Record<string, string>;
  /** Where the service posts its own status, for "is it them or me?". */
  statusPage?: string;
  /** What travels on this connection, as an example, not a live value. */
  sample?: { sends: unknown; gets: unknown };
}

export const PROBES: Record<string, ProbeDef> = {
  stripe: {
    title: "Your secret key can read your account balance",
    env: { KEY: ["STRIPE_SECRET_KEY"] },
    url: "https://api.stripe.com/v1/balance",
    headers: { authorization: "Bearer {KEY}" },
    statusPage: "https://status.stripe.com",
    sample: { sends: { amount: 2000, currency: "usd", "metadata[booking_id]": "bk_123" }, gets: { id: "pi_3Q...", status: "requires_payment_method", client_secret: "pi_3Q..._secret_..." } },
  },
  resend: {
    title: "Your key can list your sending domains",
    env: { KEY: ["RESEND_API_KEY"] },
    url: "https://api.resend.com/domains",
    headers: { authorization: "Bearer {KEY}" },
    statusPage: "https://resend-status.com",
    sample: { sends: { from: "Fade <hello@fade.app>", to: ["sam@example.com"], subject: "Your booking", html: "<p>See you at 3pm</p>" }, gets: { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" } },
  },
  postmark: {
    title: "Your server token can read your server",
    env: { KEY: ["POSTMARK_SERVER_TOKEN", "POSTMARK_API_TOKEN"] },
    url: "https://api.postmarkapp.com/server",
    headers: { "X-Postmark-Server-Token": "{KEY}", accept: "application/json" },
    statusPage: "https://status.postmarkapp.com",
  },
  sendgrid: {
    title: "Your key can read its own permissions",
    env: { KEY: ["SENDGRID_API_KEY"] },
    url: "https://api.sendgrid.com/v3/scopes",
    headers: { authorization: "Bearer {KEY}" },
    statusPage: "https://status.sendgrid.com",
  },
  openai: {
    title: "Your key can list models",
    env: { KEY: ["OPENAI_API_KEY"] },
    url: "https://api.openai.com/v1/models",
    headers: { authorization: "Bearer {KEY}" },
    statusPage: "https://status.openai.com",
    sample: { sends: { model: "gpt-6-luna", messages: [{ role: "user", content: "Summarize this booking" }] }, gets: { choices: [{ message: { content: "Sam booked a fade for 3pm Friday." } }] } },
  },
  anthropic: {
    title: "Your key can list models",
    env: { KEY: ["ANTHROPIC_API_KEY"] },
    url: "https://api.anthropic.com/v1/models",
    headers: { "x-api-key": "{KEY}", "anthropic-version": "2023-06-01" },
    statusPage: "https://status.anthropic.com",
    sample: { sends: { model: "claude-opus-5", max_tokens: 300, messages: [{ role: "user", content: "Summarize this booking" }] }, gets: { content: [{ type: "text", text: "Sam booked a fade for 3pm Friday." }] } },
  },
  "supabase-db": {
    title: "Your project answers",
    env: { URL: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"], KEY: ["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"] },
    url: "{URL}/auth/v1/health",
    headers: { apikey: "{KEY}" },
    statusPage: "https://status.supabase.com",
  },
  openweather: {
    title: "Your key can read today's weather",
    env: { KEY: ["OPENWEATHER_API_KEY"] },
    url: "https://api.openweathermap.org/data/2.5/weather?q=London&appid={KEY}",
    statusPage: "https://status.openweathermap.org",
    sample: { sends: { q: "London", appid: "your key" }, gets: { weather: [{ main: "Clouds" }], main: { temp: 285.4 } } },
  },
  mapbox: {
    title: "Your token can look up a place",
    env: { KEY: ["MAPBOX_ACCESS_TOKEN", "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "PUBLIC_MAPBOX_ACCESS_TOKEN"] },
    url: "https://api.mapbox.com/search/geocode/v6/forward?q=Chicago&limit=1&access_token={KEY}",
    statusPage: "https://status.mapbox.com",
  },
  espn: {
    title: "The NFL scoreboard answers",
    env: {},
    url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
    sample: { sends: { path: "/apis/site/v2/sports/football/nfl/scoreboard" }, gets: { week: { number: 3 }, events: [{ name: "Chiefs at Bills", status: { type: { state: "pre" } } }] } },
  },
  sleeper: {
    title: "The NFL season state answers",
    env: {},
    url: "https://api.sleeper.app/v1/state/nfl",
    sample: { sends: { path: "/v1/state/nfl" }, gets: { season: "2026", week: 3, season_type: "regular" } },
  },
};

export interface BuiltProbe {
  url: string;
  headers: Record<string, string>;
  /** The request as the page shows it, with every key masked. */
  shown: { url: string; headers: Record<string, string> };
  /** Values to mask in anything that comes back. */
  secrets: string[];
}

/** Fill a probe from the project's env, or say which names are missing. */
export function buildProbe(def: ProbeDef, env: Record<string, string>): BuiltProbe | { missing: string[] } {
  const filled: Record<string, string> = {};
  const missing: string[] = [];
  for (const [slot, names] of Object.entries(def.env)) {
    const name = names.find((n) => env[n]);
    if (name) filled[slot] = env[name];
    else missing.push(names[0]);
  }
  if (missing.length) return { missing };
  const fill = (text: string, show: boolean) => text.replace(/\{([A-Z]+)\}/g, (_, slot: string) => (show && slot !== "URL" ? mask(filled[slot]) : slot === "URL" ? filled[slot].replace(/\/+$/, "") : filled[slot]));
  const headers = Object.fromEntries(Object.entries(def.headers ?? {}).map(([k, v]) => [k, fill(v, false)]));
  return {
    url: fill(def.url, false),
    headers,
    shown: { url: fill(def.url, true), headers: Object.fromEntries(Object.entries(def.headers ?? {}).map(([k, v]) => [k, fill(v, true)])) },
    secrets: Object.entries(filled)
      .filter(([slot]) => slot !== "URL")
      .map(([, v]) => v),
  };
}

/** A response body cut to a readable size, with any key that came back masked. */
export function safeBody(text: string, secrets: string[], limit = 2000): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 6) out = out.split(secret).join(mask(secret));
  try {
    out = JSON.stringify(JSON.parse(out), null, 2);
  } catch {
    // Not JSON: show it as it came.
  }
  return out.length > limit ? `${out.slice(0, limit)}\n... (${out.length - limit} more characters)` : out;
}
