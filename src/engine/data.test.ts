import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { indexCatalog } from "./evaluate";
import { checkCatalog, unverifiedPairs } from "./integrity";
import { loadCatalog } from "./load";
import { recommend } from "./score";

/** These run against the real /data. They are the checks a pull request to the data must pass. */

const catalog = loadCatalog(path.join(__dirname, "..", "..", "data"));

describe("data", () => {
  it("passes every cross-file check", () => {
    expect(checkCatalog(catalog)).toEqual([]);
  });

  it("gives every pair of fully researched options a real verdict", () => {
    expect(unverifiedPairs(catalog)).toEqual([]);
  });

  it("offers at least one fully researched option for every slot", () => {
    for (const slot of catalog.slots) {
      expect(catalog.options.some((o) => o.coverage === "full" && o.slots.includes(slot.id)), slot.id).toBe(true);
    }
  });

  it("recommends a plan with nothing blocked for a typical app, quickly", () => {
    const index = indexCatalog(catalog);
    const answers = Object.fromEntries(catalog.needs.map((n) => [n.id, "yes" as const]));
    const started = performance.now();
    const rec = recommend(index, { answers, size: "up_to_1000", priority: "spend_zero" });
    const elapsed = performance.now() - started;
    expect(rec.results.filter((r) => r.level === "blocked")).toEqual([]);
    // Background jobs and the phone app are optional parts; every needed part gets filled.
    expect(Object.values(rec.selection).filter(Boolean).length).toBe(rec.needed.length);
    expect(rec.needed).not.toContain("jobs");
    expect(elapsed).toBeLessThan(1500);
  });

  it("gives a plain web app Next.js: frameworks tie on every score, and tie_order breaks the tie", () => {
    const index = indexCatalog(catalog);
    const rec = recommend(index, { answers: { saves_data: "yes", login: "yes" }, size: "up_to_100", priority: "spend_zero" });
    expect(rec.selection.framework).toBe("nextjs");
  });

  it("starts an AI app with Claude, a product decision in planning.json's starting_picks", () => {
    const index = indexCatalog(catalog);
    const rec = recommend(index, { answers: { saves_data: "yes", login: "yes", ai_features: "yes" }, size: "up_to_100", priority: "spend_zero" });
    expect(rec.selection.ai).toBe("anthropic");
    expect(index.optionsById.get("anthropic")?.name).toBe("Claude API");
  });

  it("has a logo file on disk for every option", () => {
    const missing = catalog.options.filter((o) => !fs.existsSync(path.join(__dirname, "..", "..", "public", "logos", catalog.logos[o.id]?.file ?? "none")));
    expect(missing.map((o) => o.id)).toEqual([]);
  });

  it("has teaching content for every part and every term it uses", () => {
    for (const slot of catalog.slots) expect(catalog.learn.slots[slot.id], slot.id).toBeDefined();
    expect(Object.keys(catalog.learn.terms).length).toBeGreaterThanOrEqual(30);
  });

  it("gives every part 2 to 4 further-reading links, all over https", () => {
    for (const slot of catalog.slots) {
      const links = catalog.learn.slots[slot.id]?.read_more ?? [];
      expect(links.length, slot.id).toBeGreaterThanOrEqual(2);
      expect(links.length, slot.id).toBeLessThanOrEqual(4);
    }
    const all = [
      ...(catalog.learn.start_here?.read_more ?? []),
      ...Object.values(catalog.learn.slots).flatMap((entry) => entry?.read_more ?? []),
      ...Object.values(catalog.learn.terms).flatMap((term) => term.read_more),
    ];
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((link) => !link.url.startsWith("https://")).map((link) => link.url)).toEqual([]);
  });
});
