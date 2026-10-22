import type { BuildTask } from "./buildplan";
import { optionIn, type CatalogIndex } from "./evaluate";
import { isOwn } from "./own";
import type { PlanInput, Selection, SlotId } from "./schema";
import { optionStats } from "./stats";

/**
 * How to test each task in the build plan, for the coding agent that builds it. The point is a
 * small suite that proves the app's own code and never leans on the real service: tests that
 * call Stripe, send email or spend AI credit are slow, flaky, cost money and still prove
 * nothing about the provider. So every plan says what to check, how to keep the service out,
 * what not to test, and the limits StackWise knows for that service (from its facts), so a
 * test can be written for the edge the plan will hit first.
 *
 * The guidance is StackWise's own, by kind of part: it never claims anything about a specific
 * provider that isn't in the facts. Pure, and read by the MCP tool, the agent files and the
 * task brief.
 */

export interface TestPlan {
  id: string;
  title: string;
  /** What to check, one test each. */
  checks: string[];
  /** How to keep the real service out of the tests. */
  fakes: string[];
  /** What not to test, so the suite stays small and never spends credit or hits a limit. */
  limits: string[];
  /** The service's limits and prices StackWise knows, to test the edge the plan will hit first. */
  known: string[];
}

interface Guidance {
  checks: string[];
  fakes: string[];
  limits?: string[];
}

/** {s} is the service's name; {a} the app's. */
const BY_SLOT: Partial<Record<SlotId, Guidance>> = {
  framework: {
    checks: ["The app builds and starts with every planned environment variable set to a dummy value.", "Each main page renders without an error, with a logged-out visitor and a logged-in test user."],
    fakes: ["Point every service variable at a fake or a test-mode value in the test environment, never at a real account."],
  },
  hosting: {
    checks: ["A smoke test after deploy: the health route answers 200 and the home page renders.", "Every planned environment variable is present in the host's settings (the deploy fails loudly when one is missing)."],
    fakes: ["Run the smoke test against a preview deploy, not production."],
    limits: ["Don't test the host itself: one smoke test per deploy is enough."],
  },
  domain: {
    checks: ["The site answers on the domain and redirects www or the bare name to the one you chose.", "Email sending records (SPF, DKIM) resolve, when email is in the plan."],
    fakes: ["Check DNS with a lookup, not by sending real mail."],
    limits: ["DNS changes take time to spread: check once after setup, not in the test suite."],
  },
  database: {
    checks: ["Each thing the app saves comes back the same: write it, read it, compare.", "A person only sees their own rows: a query as user A never returns user B's data.", "A migration runs from empty to current on a fresh database."],
    fakes: ["Run against a throwaway database (a fresh schema per test run), never the real one; point the database variable at it."],
    limits: ["Don't test {s} itself: test your queries and your rules about who can read what."],
  },
  login: {
    checks: ["A signed-out visitor is sent to sign in on every page that needs an account.", "A signed-in test user reaches their own data and nobody else's.", "Signing out clears the session, and a stale or forged session is refused."],
    fakes: ["Stub the identity: a fake session for a test user, so tests never go through {s}'s sign-in screens."],
    limits: ["Don't test {s}'s sign-in flow itself: test what your app does with a session it trusts."],
  },
  email: {
    checks: ["Each email the plan names is sent to the right address with the right subject, once.", "A send failure is handled: the app keeps working and the failure is logged."],
    fakes: ["Capture outgoing mail in a fake sender and assert on it; never send real mail from tests."],
    limits: ["Don't test delivery: send one real email by hand after setup to confirm the domain is verified."],
  },
  files: {
    checks: ["An upload is saved under the expected path and can be read back by its owner.", "A private file can't be read without being signed in, and a file over the size limit is refused."],
    fakes: ["Use a fake storage client, or a throwaway bucket, in tests; never the real bucket."],
    limits: ["Don't test {s}'s availability: test your paths, permissions and size checks."],
  },
  payments: {
    checks: ["A webhook for a successful payment flips the account to paid, and the same webhook twice flips it once.", "A webhook with a bad signature is refused.", "The page never decides who has paid: it reads what the webhook saved."],
    fakes: ["Use {s}'s test mode keys, and replay a recorded webhook body with a valid test signature; never charge a real card."],
    limits: ["Don't test checkout end to end in the suite: do it once by hand in test mode."],
  },
  ai: {
    checks: ["The prompt is assembled as planned from the inputs (the right pieces, in the right order, within the size limit).", "The answer is parsed as planned, and a malformed or empty answer is handled.", "A free account stops at its limit, counted where the plan says."],
    fakes: ["Record one real response once and replay it; tests never call {s} for real."],
    limits: ["Don't test the model's wording: test your prompt and your parsing. Keep a guard that fails any test that would spend credit."],
  },
  scraping: {
    checks: ["A saved copy of a page parses into the fields the app needs.", "A changed or blocked page is noticed: the app reports it instead of saving nothing."],
    fakes: ["Replay saved pages or responses; never fetch live sites in tests."],
    limits: ["Don't test {s} itself: test your parsing and your handling of a page that changed."],
  },
  jobs: {
    checks: ["Each job does its work when run directly with a sample payload.", "A job that fails retries as planned, and its last failure is recorded where the person will see it.", "A scheduled job is registered with the right schedule."],
    fakes: ["Call the job function directly with a fake queue; never wait on {s} in tests."],
    limits: ["Don't test timing: test the work, the retry and the failure path."],
  },
  analytics: {
    checks: ["Each planned event is sent with the planned name and fields, and nothing private (no passwords, no document text)."],
    fakes: ["Use a fake client that records events; never send test traffic to the real dashboard."],
    limits: ["Don't test {s}'s charts: test that your events are named and shaped as planned."],
  },
  monitoring: {
    checks: ["An error in a request is reported with the ids the plan allows and nothing private.", "The alert rule in the plan exists (checked once by hand)."],
    fakes: ["Use a fake reporter in tests; never report test errors to the real project."],
    limits: ["Don't test {s}'s alerting: raise one real error by hand after setup."],
  },
  mobile: {
    checks: ["The phone app signs in through the server, never straight to a service.", "A screen for each planned feature renders with sample data."],
    fakes: ["Point the phone app at a fake server in tests."],
  },
  automations: {
    checks: ["The webhook or trigger handler, given a sample payload, makes the planned outgoing call once.", "A payload that fails to validate is refused."],
    fakes: ["Replay a sample payload and assert against a fake receiver; never trigger the real automation in tests."],
  },
  data_apis: {
    checks: ["A saved response parses into what the app needs.", "An error, a rate limit and a changed response are each handled without crashing."],
    fakes: ["Replay saved responses; never call {s} in tests."],
    limits: ["Don't test {s}: test your parsing and your fallbacks."],
  },
};

const OWN: Guidance = {
  checks: ["Your own code does what SPEC.md says, tested on its interface with sample inputs.", "The app reaches it through one adapter, so the adapter can be faked in the app's tests."],
  fakes: ["Fake the adapter in the app's tests; test your own code on its own."],
};
const CUSTOM: Guidance = {
  checks: ["The app reaches {s} through one adapter that does what the note says.", "A failure from {s} is handled: the app keeps working and says what happened."],
  fakes: ["Fake the adapter in tests; StackWise has no facts on {s}, so read its docs for a test mode."],
};
const LINK: Guidance = {
  checks: ["Driving the sending side produces the planned payload, exactly once.", "The receiving side handles a sample payload, and refuses a malformed one."],
  fakes: ["Fake the receiving side when testing the sender, and replay a captured payload when testing the receiver."],
  limits: ["One integration test per line, with fakes at both ends; never both real services at once."],
};
const SETUP: Guidance = {
  checks: ["Every name in .env.example has a value in the test environment, and the app refuses to start without the ones it needs."],
  fakes: ["Dummy values in a .env.test; the real values stay in .env.local, out of git."],
  limits: ["Nothing here calls a service: it's about the names being present."],
};

const EVERYWHERE = ["Tests never call the real service, never send real mail or money, and never spend AI credit.", "One integration test per connection, with the service faked; everything else is a unit test behind an adapter."];

const fill = (lines: string[], service: string, app: string) => lines.map((line) => line.replaceAll("{s}", service).replaceAll("{a}", app));

/** The test plan for one task of the build plan. */
export function testPlan(index: CatalogIndex, input: PlanInput, selection: Selection, task: BuildTask, appName = "the app"): TestPlan {
  const app = appName.trim() || "the app";
  let guidance: Guidance;
  let service = task.title;
  let known: string[] = [];
  if (task.kind === "setup") guidance = SETUP;
  else if (task.kind === "link") guidance = LINK;
  else if (task.kind === "custom") {
    guidance = CUSTOM;
    service = task.title.replace(/ \(added by you\)$/, "");
  } else {
    const slot = task.slot;
    const option = task.kind === "extra" ? index.optionsById.get(input.extras?.[task.id.slice("extra:".length)]?.option ?? "") : optionIn(index, selection, slot);
    service = option?.name ?? task.title;
    guidance = task.kind === "own" || isOwn(option?.id) ? OWN : (BY_SLOT[slot] ?? { checks: ["It works end to end with the service faked."], fakes: ["Fake the service in tests."] });
    if (option && !isOwn(option.id)) known = optionStats(index, option, slot, input).map((s) => `${s.label}: ${s.value}`);
  }
  return {
    id: task.id,
    title: task.title,
    checks: fill(guidance.checks, service, app),
    fakes: fill(guidance.fakes, service, app),
    limits: [...fill(guidance.limits ?? [], service, app), ...EVERYWHERE],
    known,
  };
}

/** The plan as text, for a brief or an agent file. */
export function testPlanText(plan: TestPlan): string[] {
  return [
    "Check:",
    ...plan.checks.map((c) => `- ${c}`),
    "",
    "Keep the service out:",
    ...plan.fakes.map((f) => `- ${f}`),
    "",
    "Don't:",
    ...plan.limits.map((l) => `- ${l}`),
    ...(plan.known.length ? ["", "Limits StackWise knows, to test the edge first:", ...plan.known.map((k) => `- ${k}`)] : []),
  ];
}
