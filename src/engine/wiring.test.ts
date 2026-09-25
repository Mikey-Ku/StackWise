import { describe, expect, it } from "vitest";
import { connectionLabel, connectionsOf, envFileText, isBrowserEnv, planEnv } from "./wiring";
import type { Option, Selection } from "./schema";
import { fixtureIndex, fixtureOptions } from "./test-fixtures";

/** A framework whose browser prefix isn't Next.js's, to check names are renamed to match it. */
const viteFramework: Option = {
  id: "react-vite",
  name: "react-vite",
  provider: "open-source",
  slots: ["framework"],
  summary: "fixture",
  website: "https://example.com",
  coverage: "full",
  facts: {},
  setup: [],
  builder_notes: [],
};

const keyedLogin: Option = {
  ...viteFramework,
  id: "login-keys",
  name: "login-keys",
  slots: ["login"],
  setup: [
    { step: "Copy both keys from the dashboard.", env: ["NEXT_PUBLIC_LOGIN_KEY", "LOGIN_SECRET"], source: "https://example.com/keys" },
    { step: "Add the webhook secret.", env: ["LOGIN_WEBHOOK", "LOGIN_SECRET"], source: "not a url" },
  ],
};

/** Every other fixture option asks for one key; this one asks for none. */
const keylessDomain: Option = { ...viteFramework, id: "domain-free", name: "domain-free", slots: ["domain"], facts: { com_first_year_usd: { value: 9, note: "fixture", source: "https://example.com/fixture", retrieved: "2026-09-15", status: "draft" } } };

const index = fixtureIndex({ options: [...fixtureOptions, viteFramework, keyedLogin, keylessDomain] });
const selection: Selection = { framework: "fw-server", database: "db-hosted", login: "login-keys", hosting: "host-serverless" };

describe("planEnv", () => {
  it("traces every variable back to the step that gives you its value", () => {
    const vars = planEnv(index, selection);
    const login = vars.find((v) => v.name === "LOGIN_SECRET")!;
    expect(login.optionName).toBe("login-keys");
    expect(login.slot).toBe("login");
    expect(login.step).toBe("Copy both keys from the dashboard.");
    expect(login.source).toBe("https://example.com/keys");
  });

  it("keeps a repeated name once, and drops a source that isn't a link", () => {
    const vars = planEnv(index, selection).filter((v) => v.name === "LOGIN_SECRET");
    expect(vars).toHaveLength(1);
    expect(planEnv(index, selection).find((v) => v.name === "LOGIN_WEBHOOK")!.source).toBeUndefined();
  });

  it("lists parts in setup order, the app first and hosting last", () => {
    const slots = [...new Set(planEnv(index, selection).map((v) => v.slot))];
    expect(slots).toEqual(["framework", "database", "login", "hosting"]);
  });

  it("renames browser variables to the framework's prefix and marks them", () => {
    const vars = planEnv(index, { ...selection, framework: "react-vite" });
    const names = vars.map((v) => v.name);
    expect(names).toContain("VITE_LOGIN_KEY");
    expect(names).not.toContain("NEXT_PUBLIC_LOGIN_KEY");
    expect(vars.find((v) => v.name === "VITE_LOGIN_KEY")!.browser).toBe(true);
    expect(vars.find((v) => v.name === "LOGIN_SECRET")!.browser).toBe(false);
  });

  it("knows which prefixes reach the browser", () => {
    expect(isBrowserEnv("NEXT_PUBLIC_KEY")).toBe(true);
    expect(isBrowserEnv("EXPO_PUBLIC_KEY")).toBe(true);
    expect(isBrowserEnv("PUBLIC_KEY_THING")).toBe(true);
    expect(isBrowserEnv("STRIPE_SECRET_KEY")).toBe(false);
  });
});

describe("connectionsOf", () => {
  const connections = connectionsOf(index, selection);

  it("is one line per part the app uses, never the framework", () => {
    expect(connections.map((c) => c.slot)).toEqual(["database", "login", "hosting"]);
  });

  it("says in one sentence what travels along it", () => {
    const database = connections.find((c) => c.slot === "database")!;
    expect(database.label).toBe("stores data in");
    expect(database.what).toBe("Your app stores data in db-hosted. Your code reads DB_HOSTED_KEY to reach it.");
  });

  it("marks hosting as carrying every variable in the plan", () => {
    const hosting = connections.find((c) => c.slot === "hosting")!;
    expect(hosting.everything).toBe(true);
    expect(hosting.what).toContain("Every variable in this plan");
    expect(hosting.what).toContain("host-serverless' settings");
  });

  it("says when a part has no variable written down, without claiming it needs none", () => {
    const [withSteps] = connectionsOf(index, { framework: "fw-server", domain: "domain-free" });
    expect(withSteps.env).toHaveLength(0);
    expect(withSteps.stepsKnown).toBe(false);
    expect(withSteps.what).toContain("Nobody has researched its setup yet");
  });

  it("tells a researched part with no variables apart from one nobody has researched", () => {
    const researched = { ...keylessDomain, id: "domain-steps", name: "domain-steps", setup: [{ step: "Buy the name.", env: [], source: "https://example.com/buy" }] };
    const [connection] = connectionsOf(fixtureIndex({ options: [...fixtureOptions, researched] }), { framework: "fw-server", domain: "domain-steps" });
    expect(connection.stepsKnown).toBe(true);
    expect(connection.what).toContain("No environment variable is written down");
  });
});

describe("connectionLabel", () => {
  const all = planEnv(index, selection);
  const connections = connectionsOf(index, selection);
  const label = (slot: string) => connectionLabel(connections.find((c) => c.slot === slot)!, all);

  it("names one or two variables and counts more", () => {
    expect(label("database")).toBe("stores data in: DB_HOSTED_KEY");
    expect(label("login")).toBe("logs people in with: 3 variables");
  });

  it("counts the whole plan on the hosting line", () => {
    expect(label("hosting")).toBe(`runs on: ${all.length} variables`);
  });

  it("falls back to the verb when nothing travels", () => {
    const [domain] = connectionsOf(index, { framework: "fw-server", domain: "domain-free" });
    expect(connectionLabel(domain, [])).toBe("registers its domain with");
  });
});

describe("envFileText", () => {
  const text = envFileText(planEnv(index, selection), { appName: "Bird count", generatedOn: "2026-09-15" });

  it("groups names under the service, with its docs once, and the step that gives you the value", () => {
    expect(text).toContain("# login-keys\n# Docs: https://example.com/keys\n# Copy both keys from the dashboard.\nNEXT_PUBLIC_LOGIN_KEY=\nLOGIN_SECRET=");
  });

  it("never writes a value, and says the file stays out of git", () => {
    for (const line of text.split("\n")) if (line && !line.startsWith("#")) expect(line).toMatch(/^[A-Z0-9_]+=$/);
    expect(text).toContain("Keep this file out of git");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toContain("—");
  });

  it("says so when a plan needs no variables", () => {
    expect(envFileText([], { appName: "", generatedOn: "2026-09-15" })).toContain("No service in this plan needs a variable yet.");
  });
});
