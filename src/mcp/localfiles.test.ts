import { describe, expect, it } from "vitest";
import { missingEnvNames, planWrites, resolveFolder } from "./localfiles";

const HOME = "/Users/sam";
const STACKWISE = "/Users/sam/code/stackwise";
const resolve = (input: string) => resolveFolder(input, HOME, STACKWISE);
const errorOf = (input: string) => (resolve(input) as { error: string }).error;

describe("resolveFolder", () => {
  it("expands ~ and tidies the path", () => {
    expect(resolve("~/code/my-app")).toEqual({ path: "/Users/sam/code/my-app" });
    expect(resolve("  /Users/sam/code/a/../b  ")).toEqual({ path: "/Users/sam/code/b" });
  });

  it("stays inside the home folder", () => {
    expect(errorOf("/etc/passwd")).toContain("only writes inside your home folder");
    expect(errorOf("~/../other/app")).toContain("only writes inside your home folder");
    expect(errorOf("~")).toContain("not the home folder itself");
    expect(errorOf("code/my-app")).toContain("Use a full path");
    expect(errorOf("  ")).toContain("Type a folder");
  });

  it("refuses StackWise's own folder", () => {
    expect(errorOf("~/code/stackwise")).toContain("StackWise's own folder");
    expect(errorOf("~/code/stackwise/src")).toContain("StackWise's own folder");
    expect(resolve("~/code/stackwise-app")).toEqual({ path: "/Users/sam/code/stackwise-app" });
  });

  it("refuses system folders and hidden folders", () => {
    expect(errorOf("~/Library/Preferences/app")).toContain("isn't a place for a project");
    expect(errorOf("~/code/.config/app")).toContain("isn't a place for a project");
    expect(errorOf("~/code/app/node_modules")).toContain("isn't a place for a project");
  });
});

describe("planWrites", () => {
  const files = [
    { name: "SPEC.md", content: "spec" },
    { name: ".env.local", content: "KEY=" },
    { name: ".claude/agents/build-hosting.md", content: "agent" },
  ];

  it("writes everything into an empty folder", () => {
    const { write, keep } = planWrites(files, () => false, false);
    expect(write.map((f) => f.name)).toEqual(["SPEC.md", ".env.local", ".claude/agents/build-hosting.md"]);
    expect(keep).toEqual([]);
  });

  it("leaves files that are already there alone until asked", () => {
    const { write, keep } = planWrites(files, (name) => name === "SPEC.md", false);
    expect(write.map((f) => f.name)).toEqual([".env.local", ".claude/agents/build-hosting.md"]);
    expect(keep[0].name).toBe("SPEC.md");
    expect(keep[0].why).toContain("Replace files that are already there");
  });

  it("never writes over an existing .env.local, even when asked to replace", () => {
    const { write, keep } = planWrites(files, () => true, true);
    expect(write.map((f) => f.name)).toEqual(["SPEC.md", ".claude/agents/build-hosting.md"]);
    expect(keep).toEqual([{ name: ".env.local", why: "It's already there, and your real values live in it. StackWise never writes over it." }]);
  });
});

describe("missingEnvNames", () => {
  it("finds the names an existing file doesn't have yet", () => {
    const file = "# Neon\nDATABASE_URL=postgres://x\nexport STRIPE_SECRET_KEY = sk_test\n\n# RESEND_API_KEY=\n";
    expect(missingEnvNames(["DATABASE_URL", "STRIPE_SECRET_KEY", "RESEND_API_KEY"], file)).toEqual(["RESEND_API_KEY"]);
  });

  it("asks for nothing when there's no file yet", () => {
    expect(missingEnvNames(["DATABASE_URL"], null)).toEqual([]);
  });
});
