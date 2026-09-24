import { describe, expect, it } from "vitest";
import { evaluatePlan, neededSlots } from "./evaluate";
import { SLOT_IDS, type PlanInput, type Selection, type SlotId } from "./schema";
import { alternativesFor, closeCalls, criterionLabel, criterionScores, recommend, scorePlan } from "./score";
import { fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();

/** Try every combination of fully covered options and return the best total. */
function bruteForceBest(plan: PlanInput, pinned: Selection = {}): number {
  const slots = SLOT_IDS.filter((s) => neededSlots(index, plan).includes(s) || Boolean(pinned[s])).filter((s) => pinned[s] !== "");
  const lists = slots.map((slot) =>
    pinned[slot] ? [pinned[slot]!] : index.catalog.options.filter((o) => o.coverage === "full" && o.slots.includes(slot)).map((o) => o.id),
  );
  let best = -Infinity;
  const walk = (i: number, selection: Selection) => {
    if (i === slots.length) {
      const results = evaluatePlan(index, selection, plan);
      best = Math.max(best, scorePlan(index, selection, plan, results).total);
      return;
    }
    for (const id of lists[i]) walk(i + 1, { ...selection, [slots[i] as SlotId]: id });
  };
  walk(0, Object.fromEntries(SLOT_IDS.filter((s) => pinned[s] === "").map((s) => [s, ""])));
  return best;
}

describe("criteria", () => {
  it("compares domains by first-year and renewal price, since none are free", () => {
    const cheap = criterionScores(index, index.optionsById.get("domain-cheap")!, "domain", input());
    const promo = criterionScores(index, index.optionsById.get("domain-promo")!, "domain", input());
    expect(promo.cost).toBeGreaterThan(cheap.cost);
    expect(cheap.price).toBeGreaterThan(promo.price);
    expect([criterionLabel("cost", "domain"), criterionLabel("price", "domain"), criterionLabel("cost", "hosting")]).toEqual(["cheaper for the first year", "cheaper to renew", "free at your size"]);
  });

  it("compares payment services by the fee on a typical sale", () => {
    const card = criterionScores(index, index.optionsById.get("pay-card")!, "payments", input());
    const merchant = criterionScores(index, index.optionsById.get("pay-merchant")!, "payments", input());
    // 2.9% + $0.30 keeps 4.4% of a $20 sale; 5% + $0.50 keeps 7.5%.
    expect(card.price).toBeCloseTo(0.56, 5);
    expect(merchant.price).toBeCloseTo(0.25, 5);
    expect(recommend(index, input({ users_pay: "yes" })).selection.payments).toBe("pay-card");
    expect(criterionLabel("price", "payments")).toBe("cheaper per sale");
  });
});

describe("recommend", () => {
  it("never picks a blocked combination when a working one exists", () => {
    const rec = recommend(index, input({ saves_data: "yes" }));
    expect(rec.results.some((r) => r.level === "blocked")).toBe(false);
    expect(rec.selection.database).toBeDefined();
  });

  it("is deterministic", () => {
    const plan = input({ saves_data: "yes", login: "yes", uploads: "yes", users_pay: "yes", ai_features: "yes" });
    expect(recommend(index, plan).selection).toEqual(recommend(index, plan).selection);
  });

  it("finds the same best score as trying every combination", () => {
    const plans: PlanInput[] = [
      input(),
      input({ saves_data: "yes" }),
      input({ saves_data: "yes", login: "yes", users_pay: "yes" }, { priority: "launch_fast" }),
      input({ login: "yes", uploads: "yes", large_uploads: "yes", live_updates: "yes" }, { size: "up_to_1000", priority: "learn" }),
      input({ saves_data: "yes", ai_features: "yes", long_jobs: "yes", scheduled_tasks: "yes" }, { size: "just_me", priority: "ready_to_grow" }),
    ];
    for (const plan of plans) {
      expect(recommend(index, plan).score.total).toBeCloseTo(bruteForceBest(plan), 9);
    }
  });

  it("stays exact when rules check slots outside the search", () => {
    const plan = input({ saves_data: "yes", login: "yes", long_jobs: "yes", scheduled_tasks: "yes", sends_email: "yes" }, { priority: "launch_fast" });
    const pinnedSets: Selection[] = [{}, { jobs: "jobs-caller" }, { mobile: "mobile-other" }, { email: "" }, { jobs: "jobs-durable", mobile: "mobile-react" }];
    for (const pinned of pinnedSets) {
      expect(recommend(index, plan, pinned).score.total).toBeCloseTo(bruteForceBest(plan, pinned), 9);
    }
  });

  it("changes the host when the audience outgrows a free plan", () => {
    // Just you: both hosts are free, so the cheaper paid plan wins.
    expect(recommend(index, input({}, { size: "just_me" })).selection.hosting).toBe("host-server");
    // Up to 1,000: only the serverless host is still free.
    expect(recommend(index, input({}, { size: "up_to_1000" })).selection.hosting).toBe("host-serverless");
  });

  it("keeps pinned choices and leaves cleared slots empty", () => {
    const plan = input({ saves_data: "yes", login: "yes" });
    const pinned = recommend(index, plan, { hosting: "host-server", login: "" });
    expect(pinned.selection.hosting).toBe("host-server");
    expect(pinned.selection.login).toBe("");
    expect(pinned.autoPicked).not.toContain("hosting");
    expect(pinned.results.find((r) => r.level === "missing")?.slots).toEqual(["login"]);
    expect(pinned.score.total).toBeCloseTo(bruteForceBest(plan, { hosting: "host-server", login: "" }), 9);
  });

  it("never auto-picks an option that isn't fully researched", () => {
    for (const priority of ["spend_zero", "launch_fast", "learn", "ready_to_grow"] as const) {
      expect(recommend(index, input({}, { priority })).selection.hosting).not.toBe("host-partial");
    }
  });

  it("rewards fewer accounts when launching fast", () => {
    const rec = recommend(index, input({ saves_data: "yes", login: "yes" }, { priority: "launch_fast" }));
    expect(rec.selection.login).toBe("login-acme");
    expect(rec.score.accountsSaved).toBeGreaterThan(0);
  });
});

describe("alternatives and close calls", () => {
  it("ranks every option for a slot, blocked last", () => {
    const plan = input({ saves_data: "yes" });
    const rec = recommend(index, plan);
    const alts = alternativesFor(index, plan, rec.selection, "database");
    expect(alts.map((a) => a.option.id)).toContain("db-file");
    const blockedAt = alts.findIndex((a) => a.worst === "blocked");
    if (blockedAt >= 0) expect(alts.slice(blockedAt).every((a) => a.worst === "blocked")).toBe(true);
  });

  it("reports a close call with the criterion that decided it", () => {
    // With the database pinned to a file, no login shares an account, so price alone decides.
    const plan = input({ login: "yes" }, { priority: "spend_zero" });
    const rec = recommend(index, plan, { hosting: "host-server", database: "db-file" });
    const login = closeCalls(index, plan, rec).find((c) => c.slot === "login");
    expect(login?.chosen.id).toBe("login-cheap");
    expect(login?.runnerUp.id).toBe("login-acme");
    expect(login?.decidedBy).toBe("price");
    expect(login?.margin).toBeCloseTo(0.1, 9);
  });

  it("starts a part with planning.json's starting pick, and says when another option scores higher", () => {
    const withStart = fixtureIndex({ planning: { ...index.catalog.planning, starting_picks: { login: "login-acme" } } });
    const plan = input({ login: "yes" });
    const rec = recommend(withStart, plan, { hosting: "host-server", database: "db-file" });
    expect(rec.selection.login).toBe("login-acme");
    expect(rec.startedWith).toEqual(["login"]);
    expect(rec.autoPicked).toContain("login");
    const login = closeCalls(withStart, plan, rec).find((c) => c.slot === "login");
    expect(login).toMatchObject({ decidedBy: "starting_pick", runnerUp: expect.objectContaining({ id: "login-cheap" }) });
    // Choosing a part yourself always wins over the starting pick.
    expect(recommend(withStart, plan, { login: "login-solo" }).selection.login).toBe("login-solo");
  });

  it("calls an exact tie a tie", () => {
    const withoutCheap = fixtureIndex({ options: index.catalog.options.filter((o) => o.id !== "login-cheap") });
    const plan = input({ login: "yes" });
    const rec = recommend(withoutCheap, plan, { hosting: "host-server", database: "db-file" });
    const login = closeCalls(withoutCheap, plan, rec).find((c) => c.slot === "login");
    expect(login).toMatchObject({ decidedBy: "tie", margin: 0 });
    expect(login?.chosen.id).toBe("login-acme");
  });

  it("names the perk when a pairing decides a close call", () => {
    const perkIndex = fixtureIndex({
      options: index.catalog.options.filter((o) => o.id !== "login-acme"),
      productRules: [
        {
          id: "solo-perk",
          severity: "info",
          needs: [],
          pair: [
            { slot: "login", option: "login-solo" },
            { slot: "database", option: "db-hosted" },
          ],
          title: "Solo and the hosted database share sessions",
          explanation: "Fixture perk.",
        },
      ],
    });
    const plan = input({ login: "yes" });
    const rec = recommend(perkIndex, plan, { hosting: "host-server", database: "db-hosted" });
    const login = closeCalls(perkIndex, plan, rec).find((c) => c.slot === "login");
    expect(login).toMatchObject({ decidedBy: "perks", perk: "Solo and the hosted database share sessions" });
    expect(login?.chosen.id).toBe("login-solo");
    expect(login?.runnerUp.id).toBe("login-cheap");
  });

  it("doesn't let a cost note count as a perk", () => {
    // files-direct triggers "downloads cost money"; a twin without egress fees must not lose to it.
    const twin = { ...index.catalog.options.find((o) => o.id === "files-direct")!, id: "files-free-egress", provider: "otherstore" };
    twin.facts = { ...twin.facts, egress_fees: { ...twin.facts.egress_fees, value: false } };
    const withTwin = fixtureIndex({ options: [...index.catalog.options, twin] });
    const plan = input({ uploads: "yes" });
    const rec = recommend(withTwin, plan, { hosting: "host-server" });
    const byId = (id: string) => scorePlan(withTwin, { ...rec.selection, files: id }, plan, evaluatePlan(withTwin, { ...rec.selection, files: id }, plan)).total;
    expect(byId("files-direct")).toBeCloseTo(byId("files-free-egress"), 9);
  });

  it("does not call a clear win close", () => {
    const plan = input({ saves_data: "yes", login: "yes" }, { priority: "launch_fast" });
    const rec = recommend(index, plan);
    expect(closeCalls(index, plan, rec).find((c) => c.slot === "login")).toBeUndefined();
  });
});
