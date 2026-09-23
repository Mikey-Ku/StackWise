import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SharedPlan } from "@/engine/share";
import { POST } from "./route";

/** Without Claude, the talk route answers from StackWise's facts, and a suggested swap carries the rules' verdict. */

const plan: SharedPlan = {
  v: 1,
  appName: "Fade",
  description: "Bookings for a barber shop.",
  features: "",
  answers: { saves_data: "yes", login: "yes" },
  size: "up_to_100",
  priority: "spend_zero",
  builderId: "claude-code",
  pinned: {},
  notes: {},
};

const post = (body: unknown) => POST(new Request("http://localhost:4310/api/talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  process.env.WHYSTACK_AI = "off";
});
afterEach(() => {
  delete process.env.WHYSTACK_AI;
});

describe("POST /api/talk", () => {
  it("answers from the facts when Claude is off", async () => {
    const response = await post({ plan, slot: "database", question: "Which keys do I need?" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.by).toBe("facts");
    expect(typeof body.reply).toBe("string");
    expect(body.reply.length).toBeGreaterThan(20);
  });

  it("drafts a note as a suggestion", async () => {
    const body = await (await post({ plan, slot: "database", question: "Draft a note for this" })).json();
    expect(body.proposal.text.length).toBeGreaterThan(10);
    expect(body.proposal.summary).toBe("A starting note from the facts");
  });

  it("returns a suggested swap with the verdict StackWise's rules give it", async () => {
    // Auth0 isn't fully researched, so a researched login that the rules pass scores higher.
    const body = await (await post({ plan: { ...plan, pinned: { login: "auth0" } }, slot: "login", question: "What else could I use instead?" })).json();
    expect(body.reply).toContain("checked against the rest of your plan");
    expect(Object.keys(body.swap).sort()).toEqual(["name", "optionId", "verdict"]);
    expect(body.swap.optionId).not.toBe("auth0");
    expect(body.swap.verdict).toBe("works");
  });

  it("refuses a body it can't read", async () => {
    expect((await post({ plan, slot: "teleporter", question: "hi" })).status).toBe(400);
    expect((await post({ plan, slot: "database", question: "   " })).status).toBe(400);
  });
});
