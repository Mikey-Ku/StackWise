import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeProjectFolder } from "./writeproject";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "stackwise-home-"));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const files = [
  { name: "SPEC.md", content: "# spec\n" },
  { name: ".claude/agents/a.md", content: "agent\n" },
  { name: ".env.local", content: "STRIPE_SECRET_KEY=\n" },
];

describe("writing a project into a folder", () => {
  it("writes new files, keeps existing ones unless asked, and never replaces .env.local", () => {
    const folder = path.join(home, "code", "app");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, ".env.local"), "OTHER=1\n");
    const first = writeProjectFolder(folder, files, { stackwiseRoot: "/opt/stackwise", envNames: ["STRIPE_SECRET_KEY"], home });
    expect(first).toMatchObject({ wrote: ["SPEC.md", ".claude/agents/a.md"], missingEnv: ["STRIPE_SECRET_KEY"] });
    expect(fs.readFileSync(path.join(folder, ".env.local"), "utf8")).toBe("OTHER=1\n");

    fs.writeFileSync(path.join(folder, "SPEC.md"), "mine\n");
    expect(writeProjectFolder(folder, files, { stackwiseRoot: "/opt/stackwise", envNames: [], home })).toMatchObject({ wrote: [], keep: expect.arrayContaining([expect.objectContaining({ name: "SPEC.md" })]) });
    expect(fs.readFileSync(path.join(folder, "SPEC.md"), "utf8")).toBe("mine\n");
    expect(writeProjectFolder(folder, files, { stackwiseRoot: "/opt/stackwise", envNames: [], home, replace: true })).toMatchObject({ wrote: ["SPEC.md", ".claude/agents/a.md"] });
    expect(fs.readFileSync(path.join(folder, ".env.local"), "utf8")).toBe("OTHER=1\n");
  });

  it("creates .env.local readable only by you, and refuses folders outside home", () => {
    const folder = path.join(home, "fresh");
    writeProjectFolder(folder, files, { stackwiseRoot: "/opt/stackwise", envNames: [], home });
    expect(fs.statSync(path.join(folder, ".env.local")).mode & 0o777).toBe(0o600);
    expect(writeProjectFolder("/tmp/elsewhere", files, { stackwiseRoot: "/opt/stackwise", envNames: [], home })).toHaveProperty("error");
  });
});
