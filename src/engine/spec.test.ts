import { describe, expect, it } from "vitest";
import { buildSpecPack } from "./spec";
import { fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();
const details = {
  appName: "Fade",
  description: "A booking app for a barber shop.",
  features: "- Pick a time\nPay a deposit\n",
  builderId: "claude-code",
  generatedOn: "2026-09-15",
};

describe("spec pack", () => {
  const plan = input({ saves_data: "yes", users_pay: "yes" });
  const selection = { framework: "fw-server", hosting: "host-server", database: "db-file", payments: "pay-card" };

  it("writes the spec, the setup checklist and a file for the chosen builder", () => {
    expect(buildSpecPack(index, plan, selection, details).map((f) => f.name)).toEqual(["SPEC.md", "SETUP.md", "CLAUDE.md"]);
    expect(buildSpecPack(index, plan, selection, { ...details, builderId: "lovable" }).map((f) => f.name)).toEqual(["SPEC.md", "SETUP.md", "PROMPT.txt"]);
    expect(buildSpecPack(index, plan, selection, { ...details, builderId: "cursor" })[2].name).toBe("AGENTS.md");
  });

  it("turns warnings into rules the builder must follow", () => {
    const [spec, , guide] = buildSpecPack(index, plan, selection, details);
    expect(spec.content).toContain("**Only works with a paid disk.**");
    expect(spec.content).toContain("Store the database file only on the attached persistent disk path.");
    expect(guide.content).toContain("Store the database file only on the attached persistent disk path.");
  });

  it("lists features, the build order and every environment variable name", () => {
    const [spec, setup] = buildSpecPack(index, plan, selection, details);
    expect(spec.content).toContain("- Pick a time\n- Pay a deposit");
    expect(spec.content.indexOf("Create the fw-server app")).toBeLessThan(spec.content.indexOf("Deploy to host-server"));
    expect(setup.content).toContain("HOST_SERVER_KEY=");
    expect(setup.content).toContain("PAY_CARD_KEY=");
  });

  it("describes pay-per-use parts honestly in the stack table", () => {
    const [spec] = buildSpecPack(index, plan, selection, details);
    const payments = spec.content.split("\n").find((line) => line.startsWith("| Payments |"));
    expect(payments).toContain("no monthly fee, pay per use");
    expect(payments).not.toContain("free at your size");
  });

  it("never writes an em dash", () => {
    for (const file of buildSpecPack(index, plan, selection, details)) expect(file.content).not.toContain("—");
  });
});
