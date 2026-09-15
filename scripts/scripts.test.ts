import { describe, expect, it } from "vitest";
import { fixtureCatalog } from "@/engine/test-fixtures";
import { formatComparison, scoreMethod, type EvalCase } from "./eval-core";
import { htmlToText } from "./lib";
import { iconCandidates, readableHex } from "./logos";
import { applyChecks, changesMarkdown, checkPrompt, claimsBySource } from "./source-check-core";

describe("pre-fill eval scoring", () => {
  // Structural test data for the grader only. Real eval cases are Michael's to write.
  const cases: EvalCase[] = [
    { id: "a", description: "x", expected: { login: "yes", users_pay: "no", uploads: "unclear" } },
    { id: "b", description: "y", expected: { login: "no", users_pay: "yes" } },
  ];

  it("grades accuracy, yes precision and recall, and opposite answers", () => {
    const score = scoreMethod(cases, {
      a: { login: { answer: "yes", evidence: "" }, users_pay: { answer: "yes", evidence: "" } },
      b: { users_pay: { answer: "yes", evidence: "" } },
    });
    // a: login right, users_pay opposite, uploads unclear right. b: login guessed unclear (wrong), users_pay right.
    expect(score).toMatchObject({ total: 5, correct: 3, wrongDirection: 1 });
    expect(score.yesPrecision).toBeCloseTo(2 / 3);
    expect(score.yesRecall).toBe(1);
    expect(score.perNeed.login).toEqual({ total: 2, correct: 1 });
    expect(formatComparison({ keywords: score })).toContain("| Accuracy | 60.0% |");
  });
});

describe("source checker", () => {
  const catalog = fixtureCatalog();

  it("groups facts by the page they cite", () => {
    const groups = claimsBySource(catalog, { optionId: "host-server" });
    expect([...groups.keys()]).toEqual(["https://example.com/fixture"]);
    expect(groups.get("https://example.com/fixture")?.map((c) => c.key)).toContain("host-server.persistent_disk");
  });

  it("asks about each claim with its allowed values and tells the model the page is data", () => {
    const claims = claimsBySource(catalog, { optionId: "host-server" }).get("https://example.com/fixture")!;
    const prompt = checkPrompt(catalog, "https://example.com/fixture", "Page text", claims);
    expect(prompt).toContain("key: host-server.persistent_disk");
    expect(prompt).toContain("Allowed values: none, paid_addon, included.");
  });

  it("re-dates confirmed facts, updates contradicted ones back to draft, and refuses bad values", () => {
    const options = new Map(catalog.options.map((o) => [o.id, structuredClone(o)]));
    const changes = applyChecks(
      catalog,
      options,
      {
        checks: [
          { key: "host-server.background_workers", status: "supported", correct_value_json: "", evidence: "Workers are available." },
          { key: "host-server.persistent_disk", status: "contradicted", correct_value_json: '"included"', evidence: "Every service gets a disk." },
          { key: "host-server.first_paid_usd_month", status: "contradicted", correct_value_json: '"cheap"', evidence: "Starts low." },
          { key: "host-server.scheduled_jobs", status: "unclear", correct_value_json: "", evidence: "" },
        ],
      },
      "2026-12-01",
    );
    const host = options.get("host-server")!;
    expect(host.facts.background_workers.retrieved).toBe("2026-12-01");
    expect(host.facts.persistent_disk).toMatchObject({ value: "included", status: "draft", retrieved: "2026-12-01" });
    expect(host.facts.first_paid_usd_month.value).toBe(7);
    expect(changes.map((c) => c.kind)).toEqual(["refreshed", "updated", "needs_review", "needs_review"]);
    // The catalog itself is untouched; only the copies change.
    expect(catalog.options.find((o) => o.id === "host-server")!.facts.persistent_disk.value).toBe("paid_addon");
    const report = changesMarkdown("2026-12-01", changes, [{ url: "https://example.com/js", reason: "needs JavaScript" }]);
    expect(report).toContain("1 facts changed, 2 need a person to look, 1 confirmed and re-dated, 1 pages couldn't be read.");
  });

  it("turns an HTML page into readable text without cutting anything", () => {
    const text = htmlToText("<html><style>.a{}</style><script>x()</script><h1>Pricing</h1><p>Free: 100 GB &amp; more</p></html>");
    expect(text).toBe("Pricing\nFree: 100 GB & more");
  });
});

describe("logos", () => {
  it("prefers an apple-touch-icon, then SVG, then the largest icon, and skips icons made for dark mode", () => {
    const html = `
      <link rel="icon" href="/favicon-32.png" sizes="32x32">
      <link rel="icon" href="/white-mark.png" media="(prefers-color-scheme: dark)">
      <link href="/mark.svg" rel="icon" type="image/svg+xml">
      <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png" sizes="180x180">
      <link rel="stylesheet" href="/app.css">`;
    expect(iconCandidates(html, "https://example.com/pricing")).toEqual([
      "https://cdn.example.com/touch.png",
      "https://example.com/mark.svg",
      "https://example.com/favicon-32.png",
      "https://example.com/favicon.ico",
    ]);
  });

  it("falls back to /favicon.ico once when a page declares nothing", () => {
    expect(iconCandidates("<link rel=\"icon\" href=\"/favicon.ico\">", "https://example.com")).toEqual(["https://example.com/favicon.ico"]);
  });

  it("draws near-white brand colors in ink so they show on white cards", () => {
    expect(readableHex("FFFFFF")).toBe("15171A");
    expect(readableHex("F7DF1E")).toBe("15171A");
    expect(readableHex("635BFF")).toBe("635BFF");
  });
});
