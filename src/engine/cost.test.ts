import { describe, expect, it } from "vitest";
import { costLine, costOutlook, describeTotal } from "./cost";
import { fixtureIndex, input } from "./test-fixtures";

const index = fixtureIndex();
const opt = (id: string) => index.optionsById.get(id)!;

describe("cost", () => {
  it("is free when the free plan covers the audience", () => {
    const line = costLine(index, opt("host-serverless"), "hosting", input({}, { size: "up_to_100" }));
    expect(line.kind).toBe("free");
    expect(line.monthlyUsd).toBe(0);
  });

  it("shows the first paid plan once the audience outgrows the free plan", () => {
    const line = costLine(index, opt("host-server"), "hosting", input({}, { size: "up_to_1000" }));
    expect(line).toMatchObject({ kind: "paid", monthlyUsd: 7, headline: "About $7/month" });
    expect(line.detail).toContain("just you");
  });

  it("charges from launch when a free plan forbids commercial use and the app takes payments", () => {
    const line = costLine(index, opt("host-serverless"), "hosting", input({ users_pay: "yes" }, { size: "just_me" }));
    expect(line).toMatchObject({ kind: "paid", monthlyUsd: 20 });
    expect(line.detail).toContain("doesn't allow charging customers");
  });

  it("marks unverified costs as unknown instead of free", () => {
    const line = costLine(index, opt("host-partial"), "hosting", input());
    expect(line.kind).toBe("unknown");
    const outlook = costOutlook(index, { hosting: "host-partial" }, input());
    expect(outlook.now.hasUnknown).toBe(true);
    expect(describeTotal(outlook.now)).toContain("not verified");
  });

  it("describes payments and AI as pay per use", () => {
    expect(costLine(index, opt("pay-card"), "payments", input()).headline).toBe("Pay per sale: 2.9% + 30c");
    expect(costLine(index, opt("ai-paid"), "ai", input()).headline).toBe("Pay per use from the first request");
  });

  it("looks one size ahead", () => {
    const outlook = costOutlook(index, { hosting: "host-server", database: "db-hosted" }, input({}, { size: "just_me" }));
    expect(outlook.now.monthlyUsd).toBe(0);
    expect(outlook.next?.size).toBe("up_to_100");
    expect(outlook.next?.monthlyUsd).toBe(7);
  });
});
