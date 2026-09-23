import { describe, expect, it } from "vitest";
import { detectProject } from "./detect";
import { envValues, gitignoreCovers, mask, parseEnv, setEnv, springEnvRefs } from "./envfile";
import { buildProbe, PROBES, safeBody } from "./probes";
import { checkReadOnly, postgresFrom, sqliteFrom } from "./sql";

describe("env files", () => {
  const file = "# keys\nSTRIPE_SECRET_KEY=sk_test_123\nexport RESEND_API_KEY=\"re 456\"\nEMPTY=\nNOTE=abc # comment\n";

  it("reads names and whether each has a value, never needing the value itself", () => {
    expect(parseEnv(file)).toEqual([
      { name: "STRIPE_SECRET_KEY", set: true },
      { name: "RESEND_API_KEY", set: true },
      { name: "EMPTY", set: false },
      { name: "NOTE", set: true },
    ]);
    expect(envValues(file)).toMatchObject({ RESEND_API_KEY: "re 456", NOTE: "abc" });
  });

  it("sets a value in place, keeps comments and order, adds new names at the end, and quotes when needed", () => {
    const changed = setEnv(file, "EMPTY", "x y#z");
    expect(changed).toContain('EMPTY="x y#z"');
    expect(changed.startsWith("# keys\nSTRIPE_SECRET_KEY=sk_test_123\n")).toBe(true);
    expect(envValues(changed).EMPTY).toBe("x y#z");
    expect(setEnv("", "NEW_KEY", "abc")).toBe("NEW_KEY=abc\n");
    expect(setEnv(file, "NEW_KEY", "abc").trimEnd().endsWith("NEW_KEY=abc")).toBe(true);
    expect(() => setEnv(file, "BAD NAME", "x")).toThrow();
    expect(() => setEnv(file, "OK", "two\nlines")).toThrow();
  });

  it("knows when git would keep an env file out, and what a Spring config reads", () => {
    expect(gitignoreCovers(".env*.local\nnode_modules\n", ".env.local")).toBe(true);
    expect(gitignoreCovers("/.env.local\n", ".env.local")).toBe(true);
    expect(gitignoreCovers("node_modules\n", ".env.local")).toBe(false);
    expect(gitignoreCovers(null, ".env.local")).toBe(false);
    expect(springEnvRefs("spring.datasource.url=${SPRING_DATASOURCE_URL:jdbc:h2:file:./data}\nx=${API_KEY}")).toEqual(["SPRING_DATASOURCE_URL", "API_KEY"]);
    expect(mask("sk_test_1234567890")).toMatch(/^sk_•+90$/);
    expect(mask("short")).not.toContain("s");
  });
});

describe("detecting a project", () => {
  const folder = (files: Record<string, string>) => detectProject((f) => f in files, (f) => files[f] ?? null);

  it("recognizes Wheelhouse: Spring Boot with Actuator, run-local.sh first, and its config file", () => {
    const found = folder({ "pom.xml": "<java.version>21</java.version><artifactId>spring-boot-starter-actuator</artifactId>", mvnw: "", "run-local.sh": "", ".env.local": "", "src/main/resources/application.properties": "" });
    expect(found).toMatchObject({ javaVersion: "21", framework: "spring-boot", healthUrl: "http://localhost:8080/actuator/health", envFiles: [".env.local"], configFiles: ["src/main/resources/application.properties"] });
    expect(found.commands.map((c) => c.command)).toEqual(["./run-local.sh", "./mvnw spring-boot:run"]);
  });

  it("recognizes a Next.js app from package.json and offers its scripts", () => {
    const found = folder({ "package.json": JSON.stringify({ scripts: { dev: "next dev" }, dependencies: { next: "16" } }) });
    expect(found).toMatchObject({ framework: "nextjs", healthUrl: "http://localhost:3000/", commands: [{ command: "npm run dev" }] });
  });
});

describe("live checks", () => {
  it("fills a check from the project's env, masks keys in what the page sees, and says what's missing", () => {
    const built = buildProbe(PROBES.stripe, { STRIPE_SECRET_KEY: "sk_test_abcdefghijk" });
    if ("missing" in built) throw new Error("expected a probe");
    expect(built.headers.authorization).toBe("Bearer sk_test_abcdefghijk");
    expect(JSON.stringify(built.shown)).not.toContain("abcdefghijk");
    expect(buildProbe(PROBES.stripe, {})).toEqual({ missing: ["STRIPE_SECRET_KEY"] });
    expect(buildProbe(PROBES.espn, {})).toMatchObject({ url: expect.stringContaining("site.api.espn.com") });
    expect(safeBody('{"echo":"sk_test_abcdefghijk"}', ["sk_test_abcdefghijk"])).not.toContain("abcdefghijk");
  });

  it("only ever reads: every check is a plain GET with no body", () => {
    for (const def of Object.values(PROBES)) expect(def).not.toHaveProperty("body");
  });
});

describe("the read-only SQL console", () => {
  it("runs one statement that reads, and says why anything else won't run", () => {
    expect(checkReadOnly("select * from entries limit 5;")).toBeNull();
    expect(checkReadOnly("-- recent\nWITH x AS (SELECT 1) SELECT * FROM x")).toBeNull();
    expect(checkReadOnly("SELECT ';' AS semicolon")).toBeNull();
    expect(checkReadOnly("DELETE FROM entries")).toContain("DELETE changes it");
    expect(checkReadOnly("SELECT 1; DROP TABLE entries")).toBe("Run one statement at a time.");
    expect(checkReadOnly("PRAGMA journal_mode = WAL")).toContain("changes the database");
    expect(checkReadOnly("   ")).toContain("Type a query");
  });

  it("builds a Postgres connection from a URL or from Spring's JDBC settings, and finds SQLite files", () => {
    expect(postgresFrom({ DATABASE_URL: "postgres://u:p@h/db" })).toEqual({ config: { connectionString: "postgres://u:p@h/db" }, from: "DATABASE_URL" });
    const spring = postgresFrom({ SPRING_DATASOURCE_URL: "jdbc:postgresql://db.example.com:5432/wheel?sslmode=require", SPRING_DATASOURCE_USERNAME: "wh", SPRING_DATASOURCE_PASSWORD: "p@ss" });
    expect(spring?.config.connectionString).toBe("postgresql://wh:p%40ss@db.example.com:5432/wheel?sslmode=require");
    expect(postgresFrom({ SPRING_DATASOURCE_URL: "jdbc:h2:file:./data/wheelhouse" })).toBeNull();
    expect(sqliteFrom({ DATABASE_URL: "file:./dev.db" })).toBe("./dev.db");
  });
});

describe("a new plan's description from the README", () => {
  it("keeps the opening prose and drops headings, badges, tables, code and link syntax", async () => {
    const { readmeSummary } = await import("./local");
    const readme = "# wheelhouse\n\n![build](x.svg)\n\nA fantasy football game where you **spin a wheel** to assemble a roster. See [the rules](RULES.md).\n\n| a | b |\n\n```sh\n./run\n```\n\nPlayable without signing up.";
    expect(readmeSummary(readme)).toBe("A fantasy football game where you spin a wheel to assemble a roster. See the rules. Playable without signing up.");
    expect(readmeSummary(null)).toBeNull();
    expect(readmeSummary("# Only a heading")).toBeNull();
  });
});
