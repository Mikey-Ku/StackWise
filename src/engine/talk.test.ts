import { describe, expect, it } from "vitest";
import type { SharedPlan } from "./share";
import { answerFromFacts, draftNote, questionFocus, swappable, talkBrief } from "./talk";
import { fixtureIndex } from "./test-fixtures";

const index = fixtureIndex();

const plan: SharedPlan = {
  v: 1,
  appName: "Fade",
  description: "Bookings for a barber shop.",
  features: "",
  answers: { saves_data: "yes", login: "yes", users_pay: "yes" },
  size: "up_to_100",
  priority: "spend_zero",
  builderId: "claude-code",
  pinned: { hosting: "host-serverless", database: "db-file", payments: "pay-card" },
  notes: { database: { text: "Keep bookings for a year.", optionId: "db-hosted", updatedAt: "2026-09-16T10:00:00.000Z", by: "you" } },
};

const noEmDash = (text: string) => expect(text).not.toContain("—");

describe("talkBrief", () => {
  const brief = talkBrief(index, plan, "database");

  it("gathers the part, its connection, setup, checks, cost and facts from the engine", () => {
    expect(brief.part).toMatchObject({ id: "database", label: "Database", verb: "stores data in" });
    expect(brief.option).toMatchObject({ id: "db-file", researched: true });
    expect(brief.connection!.variables).toEqual([{ name: "DB_FILE_KEY", from: "db-file", where_to_get_it: "Set up db-file.", docs: "https://example.com/setup", browser_can_read_it: false }]);
    expect(brief.setup_steps).toEqual([{ step: "Set up db-file.", variables: ["DB_FILE_KEY"], docs: "https://example.com/setup" }]);
    expect(brief.checks.some((c) => c.verdict === "doesn't work" && c.title === "Your data would disappear")).toBe(true);
    expect(brief.cost!.headline).toBeTruthy();
    expect(brief.facts.find((f) => f.fact === "Where data is kept")).toMatchObject({ value: "A file on your server", source: "https://example.com/fixture", checked_on: "2026-09-15" });
  });

  it("carries the rest of the stack and every problem the rules flag, so a question can be answered in context", () => {
    expect(brief.stack.map((p) => p.part)).toEqual(expect.arrayContaining(["Framework", "Hosting", "Database"]));
    expect(brief.stack.every((p) => typeof p.verdict === "string")).toBe(true);
    const order = ["doesn't work", "missing a service", "works, with a warning", "not verified yet"];
    const ranks = brief.plan_problems.map((p) => order.indexOf(p.verdict));
    expect(ranks.length).toBeGreaterThan(0);
    expect(ranks).not.toContain(-1);
    expect([...ranks].sort((x, y) => x - y)).toEqual(ranks);
  });

  it("lists other options with the verdict StackWise's rules give each, never the current one", () => {
    expect(brief.alternatives.map((a) => a.id)).toEqual(["db-hosted"]);
    expect(brief.alternatives[0]).toMatchObject({ verdict: "works", researched: true });
    expect(swappable(brief).map((a) => a.id)).toEqual(["db-hosted"]);
  });

  it("flags a note written for another option", () => {
    expect(brief.note).toEqual({ text: "Keep bookings for a year.", written_by: "you", written_for: "db-hosted", may_be_out_of_date: true });
  });

  it("gives hosting every variable in the plan, and the app no connection", () => {
    const hosting = talkBrief(index, plan, "hosting");
    expect(hosting.connection!.carries_every_variable).toBe(true);
    expect(hosting.connection!.variables.map((v) => v.name)).toEqual(expect.arrayContaining(["DB_FILE_KEY", "PAY_CARD_KEY", "HOST_SERVERLESS_KEY"]));
    expect(talkBrief(index, plan, "framework").connection).toBeNull();
  });
});

describe("draftNote", () => {
  it("starts from the variables, the setup in order, and what to watch", () => {
    const note = draftNote(talkBrief(index, plan, "database"));
    expect(note).toContain("Reads DB_FILE_KEY. It must never reach the browser.");
    expect(note).toContain("Setup:\n1. Set up db-file.");
    expect(note).toContain("Watch for:\n- Your data would disappear.");
    noEmDash(note);
  });

  it("asks for an option first when the part is empty", () => {
    expect(draftNote(talkBrief(index, { ...plan, pinned: { ...plan.pinned, email: "" } }, "email"))).toContain("Pick an option first");
  });
});

describe("answerFromFacts", () => {
  const brief = talkBrief(index, plan, "database");
  const ask = (question: string) => answerFromFacts(brief, question);

  it("answers the common questions from the brief", () => {
    expect(ask("Which keys do I need?").reply).toContain("- DB_FILE_KEY: Set up db-file.");
    expect(ask("How do I set this up?").reply).toContain("1. Set up db-file. (DB_FILE_KEY)");
    expect(ask("What does it cost?").reply).toContain(`db-file: ${brief.cost!.headline}.`);
    expect(ask("What could go wrong?").reply).toContain("- Your data would disappear.");
  });

  it("suggests a swap only to an option the rules pass and that ranks higher", () => {
    const answer = ask("What else could I use instead?");
    expect(answer.reply).toMatch(/- db-hosted: works\. .+\. ranks higher for your priority\./);
    expect(answer.reply).not.toMatch(/\d\.\d/);
    expect(answer.swap).toBe("db-hosted");
  });

  it("drafts a note when asked, as a proposal to accept or not", () => {
    const answer = ask("Can you write a note for this?");
    expect(answer.proposal).toEqual({ text: draftNote(brief), summary: "A starting note from the facts" });
  });

  it("says what it can answer when it doesn't recognize the question, and never invents", () => {
    const answer = ask("Tell me a joke about databases");
    expect(answer.reply).toContain("Your app stores data in db-file.");
    expect(answer.reply).toContain("ask about setup, keys, cost, problems or alternatives");
    expect(answer.swap).toBeUndefined();
    for (const q of ["keys", "set up", "cost", "instead", "problems", "note", "what is it", "hello"]) noEmDash(ask(q).reply);
  });
});

describe("questionFocus", () => {
  it("answers about the part a question names, not the one selected", () => {
    const question = "Can I use db-hosted instead of db-file for the database?";
    const focus = questionFocus(index, plan, "framework", question);
    expect(focus).toEqual({ slot: "database", mentioned: ["db-hosted"] });
    const answer = answerFromFacts(talkBrief(index, plan, focus.slot, focus.mentioned), question);
    expect(answer.reply).toMatch(/^db-hosted instead of db-file, checked against the rest of your plan:/);
    expect(answer.reply).toContain("- db-hosted: works.");
    expect(answer.swap).toBe("db-hosted");
  });

  it("finds the part from a service's name when no part is named", () => {
    expect(questionFocus(index, plan, "framework", "Is pay-card a good choice?").slot).toBe("payments");
  });

  it("stays on the selected part when the question names it or what fills it", () => {
    expect(questionFocus(index, plan, "database", "Does the database work with host-server?")).toEqual({ slot: "database", mentioned: [] });
    expect(questionFocus(index, plan, "payments", "How do I deploy pay-card webhooks?").slot).toBe("payments");
    expect(questionFocus(index, plan, "database", "How do I set this up?").slot).toBe("database");
  });
});
