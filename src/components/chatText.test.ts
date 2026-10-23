import { describe, expect, it } from "vitest";
import { isLong, parseChatText, parseInline } from "./chatText";

// The shape of a long reply an agent sent: headings in capitals, a bullet list, paragraphs.
const LONG_REPLY = [
  "Here's the project as StackWise has it, in three parts.",
  "",
  "WHAT IT IS",
  "An app that writes proposals. ".repeat(20).trim(),
  "",
  "HOW IT'S SET UP",
  "- SvelteKit on Cloudflare Workers.",
  "- Env vars your code reads: STRIPE_SECRET_KEY, RESEND_API_KEY.",
  "",
  "HOW DATA IS DONE",
  "Firestore collections: users, proposals, usage. ".repeat(10).trim(),
].join("\n");

describe("parseChatText", () => {
  it("reads headings in capitals, lists and paragraphs", () => {
    const blocks = parseChatText(LONG_REPLY);
    expect(blocks.map((b) => (b.kind === "heading" ? `h:${b.text[0].text}` : b.kind))).toEqual([
      "paragraph",
      "h:WHAT IT IS",
      "paragraph",
      "h:HOW IT'S SET UP",
      "list",
      "h:HOW DATA IS DONE",
      "paragraph",
    ]);
    const list = blocks[4];
    expect(list.kind === "list" && list.items.length).toBe(2);
  });

  it("doesn't take an environment variable's name for a heading", () => {
    expect(parseChatText("STRIPE_SECRET_KEY")[0].kind).toBe("paragraph");
    expect(parseChatText("OK")[0].kind).toBe("paragraph");
  });

  it("reads # lines and all-bold lines as headings, and *, + and • as bullets", () => {
    const blocks = parseChatText("## Setup\n**Next steps:**\n* one\n+ two\n• three\n1) first\n2) second");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "heading", "list", "list"]);
    const [, , bullets, numbers] = blocks;
    expect(bullets.kind === "list" && bullets.items.length).toBe(3);
    expect(numbers.kind === "list" && numbers.ordered).toBe(true);
  });

  it("joins an indented line to the item above, and keeps a list going over a blank line", () => {
    const blocks = parseChatText("- first item\n  goes on here\n\n- second");
    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    expect(list.kind === "list" && list.items.map((item) => item.map((part) => part.text).join(""))).toEqual(["first item goes on here", "second"]);
  });

  it("keeps a code fence as it was written", () => {
    const blocks = parseChatText("Run:\n```\npnpm dev\n  --port 4310\n```\nThen open it.");
    expect(blocks[1]).toEqual({ kind: "code", text: "pnpm dev\n  --port 4310" });
    expect(blocks[2].kind).toBe("paragraph");
  });

  it("never returns markup: a tag in a message is text", () => {
    const blocks = parseChatText('<img src=x onerror="alert(1)"> hello');
    expect(blocks).toEqual([{ kind: "paragraph", text: [{ kind: "text", text: '<img src=x onerror="alert(1)"> hello' }] }]);
  });
});

describe("parseInline", () => {
  it("reads **bold** and `code`, and leaves an unmatched marker alone", () => {
    expect(parseInline("Set **STRIPE_SECRET_KEY** in `.env.local` **now")).toEqual([
      { kind: "text", text: "Set " },
      { kind: "strong", text: "STRIPE_SECRET_KEY" },
      { kind: "text", text: " in " },
      { kind: "code", text: ".env.local" },
      { kind: "text", text: " **now" },
    ]);
  });
});

describe("isLong", () => {
  it("folds a long reply and leaves a short one open", () => {
    expect(isLong(LONG_REPLY)).toBe(true);
    expect(isLong("Hello! Paired and listening.\n\n- One thing.\n- Another.\n\nWhat would you like me to do?")).toBe(false);
  });
});
