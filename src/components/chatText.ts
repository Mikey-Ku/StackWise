/**
 * Chat text, read the way the chat pane shows it. Agents and models write a little Markdown
 * whatever they're told, so the pane understands the common parts: headings (a # line, a line
 * that is all bold, or a short line in capitals like "HOW DATA IS DONE"), lists ("-", "*", "+" or
 * "•" bullets and "1." or "1)" numbers, an indented line continuing the item above), code fences,
 * and **bold** and `code` inside a line. Everything else is plain text.
 *
 * It returns data, never HTML: the pane builds elements from it, so nothing in a message can
 * inject markup, whoever wrote it.
 */

export type Inline = { kind: "text" | "strong" | "code"; text: string };

export type ChatBlock =
  | { kind: "heading"; caps: boolean; text: Inline[] }
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; text: string };

const BULLET = /^[-*+•]\s+/;
const NUMBER = /^\d+[.)]\s+/;
const HASH = /^#{1,6}\s+(.+?)\s*#*$/;
const ALL_BOLD = /^\*\*([^*]+)\*\*:?$/;

/** A short line in capitals with a space in it reads as a heading. An environment variable's name doesn't. */
function capsHeading(line: string): boolean {
  return line.length <= 48 && /\s/.test(line) && /[A-Z]{2}/.test(line) && !/[a-z_]/.test(line) && /^[A-Z0-9][A-Z0-9 '&/,.()+:-]*$/.test(line);
}

/** **bold** and `code` inside a line. An unmatched ** or ` stays as it was typed. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(/\*\*([^*]+)\*\*|`([^`]+)`/g)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push(match[1] !== undefined ? { kind: "strong", text: match[1] } : { kind: "code", text: match[2] });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseChatText(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const titled = HASH.exec(line)?.[1] ?? ALL_BOLD.exec(line)?.[1];
    if (titled) {
      blocks.push({ kind: "heading", caps: false, text: parseInline(titled.replace(/:$/, "")) });
      i++;
      continue;
    }
    if (capsHeading(line)) {
      blocks.push({ kind: "heading", caps: true, text: [{ kind: "text", text: line.replace(/:$/, "") }] });
      i++;
      continue;
    }
    const ordered = NUMBER.test(line);
    if (ordered || BULLET.test(line)) {
      const marker = ordered ? NUMBER : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const raw = lines[i];
        const item = raw.trim();
        if (marker.test(item)) {
          items.push(item.replace(marker, ""));
          i++;
        } else if (item && /^\s/.test(raw) && items.length > 0 && !BULLET.test(item) && !NUMBER.test(item)) {
          // An indented line continues the item above it.
          items[items.length - 1] += ` ${item}`;
          i++;
        } else if (!item && i + 1 < lines.length && marker.test(lines[i + 1].trim())) {
          // A blank line between two items keeps the list going.
          i++;
        } else break;
      }
      blocks.push({ kind: "list", ordered, items: items.map(parseInline) });
      continue;
    }
    blocks.push({ kind: "paragraph", text: parseInline(line) });
    i++;
  }
  return blocks;
}

/** Past about a screen of the pane, a reply folds behind "Show more". */
export const LONG_WORDS = 130;
export const LONG_LINES = 12;

export function isLong(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const lines = text.split("\n").filter((line) => line.trim()).length;
  return words > LONG_WORDS || lines > LONG_LINES;
}
