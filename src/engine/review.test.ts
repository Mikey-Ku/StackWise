import { describe, expect, it } from "vitest";
import { editFactReview, factsBehindPlan, factsReadFor, listWords, reviewCounts, reviewedCount, reviewList, sameJson, type ReviewDefault } from "./review";
import { criterionScores, recommend, scoreFacts } from "./score";
import { SLOT_IDS, type Option, type PlanInput } from "./schema";
import { fixtureIndex, fixtureOptions, input } from "./test-fixtures";

/** The fact review: which facts come first, and how a decision edits an option file. */

const index = fixtureIndex();
const byId = (id: string) => index.optionsById.get(id)!;

describe("scoreFacts", () => {
  it("names every fact criterionScores reads, for every part", () => {
    for (const option of fixtureOptions) {
      for (const slot of option.slots) {
        for (const answers of [{}, { users_pay: "yes" }] as PlanInput["answers"][]) {
          const read = new Set<string>();
          const watched: Option = { ...option, facts: new Proxy(option.facts, { get: (target, key) => (read.add(String(key)), target[String(key)]) }) };
          criterionScores(index, watched, slot, input(answers));
          expect([...read].filter((key) => !scoreFacts(slot).includes(key)), `${option.id} in ${slot}`).toEqual([]);
        }
      }
    }
  });

  it("uses domain prices for domains and card fees for payments", () => {
    expect(scoreFacts("domain")).toEqual(["com_first_year_usd", "com_renewal_usd", "portability"]);
    expect(scoreFacts("payments")).toEqual(expect.arrayContaining(["card_fee_percent", "card_fee_fixed_usd"]));
    expect(scoreFacts("hosting")).toContain("free_plan_commercial_use");
  });
});

describe("factsReadFor and factsBehindPlan", () => {
  it("reads the part's required facts and the score's, as far as the option has them", () => {
    const required = index.slotsById.get("hosting")!.required_facts;
    expect(factsReadFor(index, byId("host-serverless"), "hosting").sort()).toEqual([...new Set([...required, ...scoreFacts("hosting")])].sort());
    expect(factsReadFor(index, byId("host-partial"), "hosting")).toEqual([]);
  });

  it("lists each option's facts for the part it fills, extras included, once each", () => {
    const refs = factsBehindPlan(index, { framework: "fw-server", hosting: "host-server", database: "db-hosted" }, { "database.cache": { slot: "database", option: "db-file", role: "cache" } });
    const keys = refs.map((r) => `${r.optionId}.${r.fact}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("fw-server.has_server_code");
    expect(keys).toContain("host-server.framework_support");
    expect(keys).toContain("db-hosted.realtime_built_in");
    expect(keys).toContain("db-file.storage_model");
    expect(keys.some((k) => k.startsWith("fw-browser."))).toBe(false);
  });

  it("counts the reviewed ones", () => {
    const reviewed = fixtureIndex({
      options: fixtureOptions.map((o) =>
        o.id === "fw-server" ? { ...o, facts: { ...o.facts, portability: { ...o.facts.portability, status: "verified" as const, reviewed: "2026-09-24" } } } : o,
      ),
    });
    const refs = factsBehindPlan(reviewed, { framework: "fw-server", hosting: "host-server" });
    expect(reviewedCount(reviewed, refs)).toBe(1);
    expect(reviewedCount(index, refs)).toBe(0);
  });
});

describe("reviewList", () => {
  const defaults: ReviewDefault[] = [
    { label: "Plain", input: input({}) },
    { label: "Saves data", input: input({ saves_data: "yes" }) },
    { label: "Pinned", input: input({ saves_data: "yes", login: "yes" }), pinned: { login: "login-solo" } },
  ];
  const items = reviewList(index, defaults);
  const behind = items.filter((i) => i.tier === "defaults");

  it("puts every fact behind a default plan first, the most used first", () => {
    const firstOther = items.findIndex((i) => i.tier === "other");
    expect(firstOther).toBe(behind.length);
    const uses = behind.map((i) => i.picks.length + i.startsWith.length);
    expect(uses).toEqual([...uses].sort((a, b) => b - a));
    // Framework and hosting are in every plan, so their facts lead.
    expect(uses[0]).toBe(3);
    expect(behind[0].why).toBe("Decides the pick in every default plan (3).");
  });

  it("collects exactly the facts the rules and score read for each default's options", () => {
    const expected = new Set<string>();
    for (const d of defaults) {
      const { selection } = recommend(index, d.input, d.pinned ?? {});
      for (const ref of factsBehindPlan(index, selection, d.input.extras)) expected.add(`${ref.optionId}.${ref.fact}`);
    }
    expect(new Set(behind.map((i) => i.key))).toEqual(expected);
  });

  it("says which defaults pick an option and which start with it", () => {
    const pinned = behind.find((i) => i.key === "login-solo.prebuilt_ui")!;
    expect(pinned.startsWith).toEqual(["Pinned"]);
    expect(pinned.picks).toEqual([]);
    expect(pinned.why).toBe("Checked in Pinned, which starts with login-solo.");
    const picked = behind.find((i) => i.fact === "data_model")!;
    expect(picked.picks).toEqual(["Saves data", "Pinned"]);
    expect(picked.why).toBe("Decides the pick for Saves data and Pinned.");
  });

  it("then lists every other fact of fully researched options, and skips partial ones", () => {
    const withPartial = fixtureIndex({
      options: [...fixtureOptions, { ...fixtureOptions[0], id: "fw-half", name: "fw-half", coverage: "partial" }],
    });
    const all = reviewList(withPartial, defaults);
    const other = all.filter((i) => i.tier === "other");
    expect(other.some((i) => i.optionId === "fw-half")).toBe(false);
    const fullFacts = fixtureOptions.filter((o) => o.coverage === "full").reduce((n, o) => n + Object.keys(o.facts).length, 0);
    expect(all.length).toBe(fullFacts);
    expect(other[0].why).toMatch(/^Read whenever .+ is in a plan\.$/);
    // By part, then name: frameworks before hosts.
    expect(SLOT_IDS.indexOf(withPartial.optionsById.get(other[0].optionId)!.slots[0])).toBeLessThanOrEqual(SLOT_IDS.indexOf(withPartial.optionsById.get(other[other.length - 1].optionId)!.slots[0]));
  });

  it("carries what a reviewer needs to check the fact", () => {
    const item = behind.find((i) => i.key === "fw-browser.first_paid_usd_month")!;
    expect(item).toMatchObject({
      optionName: "fw-browser",
      parts: ["Framework"],
      label: index.catalog.facts.first_paid_usd_month.label,
      value: null,
      display: "No monthly plan",
      note: "fixture",
      source: "https://example.com/fixture",
      retrieved: "2026-09-15",
      status: "draft",
    });
  });

  it("counts reviewed facts overall and behind the defaults", () => {
    expect(reviewCounts([
      { tier: "defaults", status: "verified" },
      { tier: "defaults", status: "draft" },
      { tier: "other", status: "verified" },
    ])).toEqual({ total: 3, reviewed: 2, behindDefaults: 2, behindDefaultsReviewed: 1 });
  });
});

describe("editFactReview", () => {
  const option = fixtureOptions.find((o) => o.id === "host-server")!;
  const spread = `${JSON.stringify(option, null, 2)}\n`;
  // The other layout in data/options: short arrays and setup steps on one line.
  const compact = spread.replace(/\[\n\s+"hosting"\n\s+\]/, '["hosting"]');

  /** The lines between the common start and the common end: what a diff would show. */
  const changedLines = (before: string, after: string) => {
    const a = before.split("\n");
    const b = after.split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    return { removed: a.slice(start, a.length - end), added: b.slice(start, b.length - end) };
  };

  it("marks a fact verified with the day, touching only its status line and adding the date under it", () => {
    for (const text of [spread, compact]) {
      const next = editFactReview(text, "persistent_disk", { status: "verified", reviewed: "2026-09-24" });
      expect(changedLines(text, next)).toEqual({ removed: ['      "status": "draft"'], added: ['      "status": "verified",', '      "reviewed": "2026-09-24"'] });
      expect(next.length - text.length).toBe(',\n      "reviewed": "2026-09-24"'.length + ("verified".length - "draft".length));
      const parsed = JSON.parse(next);
      expect(parsed.facts.persistent_disk).toMatchObject({ status: "verified", reviewed: "2026-09-24" });
      expect(Object.keys(parsed.facts.persistent_disk)).toEqual(["value", "note", "source", "retrieved", "status", "reviewed"]);
      expect(parsed.facts.runtime_model.status).toBe("draft");
    }
  });

  it("keeps the file's ending and every other fact's lines", () => {
    const next = editFactReview(spread, "framework_support", { status: "verified", reviewed: "2026-09-24" });
    expect(next.endsWith("}\n")).toBe(true);
    expect(JSON.parse(next).facts.framework_support.value).toEqual(option.facts.framework_support.value);
    expect(next.replace('"status": "verified",\n      "reviewed": "2026-09-24"', '"status": "draft"')).toBe(spread);
  });

  it("moves the date on a second review, and a draft drops it again", () => {
    const once = editFactReview(spread, "scheduled_jobs", { status: "verified", reviewed: "2026-09-24" });
    const twice = editFactReview(once, "scheduled_jobs", { status: "verified", reviewed: "2026-10-01" });
    expect(changedLines(once, twice)).toEqual({ removed: ['      "reviewed": "2026-09-24"'], added: ['      "reviewed": "2026-10-01"'] });
    expect(editFactReview(twice, "scheduled_jobs", { status: "draft" })).toBe(spread);
  });

  it("works on a fact written on one line", () => {
    const text = '{ "id": "x", "facts": { "a": { "value": 1, "note": "n", "source": "https://e.com", "retrieved": "2026-09-15", "status": "draft" } } }\n';
    expect(editFactReview(text, "a", { status: "verified", reviewed: "2026-09-24" })).toBe(
      '{ "id": "x", "facts": { "a": { "value": 1, "note": "n", "source": "https://e.com", "retrieved": "2026-09-15", "status": "verified", "reviewed": "2026-09-24" } } }\n',
    );
  });

  it("refuses a fact the file doesn't have", () => {
    expect(() => editFactReview(spread, "no_such_fact", { status: "verified", reviewed: "2026-09-24" })).toThrow(/no fact/);
    expect(() => editFactReview(spread, "toString", { status: "verified", reviewed: "2026-09-24" })).toThrow(/no fact/);
  });
});

describe("helpers", () => {
  it("joins words and compares JSON without caring about key order", () => {
    expect(listWords(["A"])).toBe("A");
    expect(listWords(["A", "B", "C"])).toBe("A, B and C");
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJson([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });
});
