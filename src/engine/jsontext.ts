/**
 * Editing a JSON file as text, so a change touches only its own lines. The option files mix
 * layouts (some put arrays and setup steps on one line, some spread them out), and
 * JSON.stringify would reflow a whole file to change one word. This finds where each value sits
 * in the text and rewrites just that span, reusing the file's own spacing for anything it adds.
 */

export interface JsonMember {
  key: string;
  /** Where the key's opening quote is, and one past its closing quote. */
  keyStart: number;
  keyEnd: number;
  value: JsonNode;
}

export interface JsonNode {
  start: number;
  /** One past the value's last character. */
  end: number;
  /** An object's members, in file order. */
  members?: JsonMember[];
}

const WS = new Set([" ", "\t", "\n", "\r"]);

function skip(text: string, i: number): number {
  while (i < text.length && WS.has(text[i])) i++;
  return i;
}

function stringEnd(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === '"') return j + 1;
  }
  throw new SyntaxError(`unterminated string at ${i}`);
}

function node(text: string, from: number): JsonNode {
  const start = skip(text, from);
  const c = text[start];
  if (c === '"') return { start, end: stringEnd(text, start) };
  if (c === "{" || c === "[") {
    const close = c === "{" ? "}" : "]";
    const members: JsonMember[] = [];
    let i = skip(text, start + 1);
    if (text[i] === close) return { start, end: i + 1, ...(c === "{" ? { members } : {}) };
    for (;;) {
      if (c === "{") {
        const keyStart = skip(text, i);
        if (text[keyStart] !== '"') throw new SyntaxError(`expected a key at ${keyStart}`);
        const keyEnd = stringEnd(text, keyStart);
        const colon = skip(text, keyEnd);
        if (text[colon] !== ":") throw new SyntaxError(`expected ":" at ${colon}`);
        const value = node(text, colon + 1);
        members.push({ key: JSON.parse(text.slice(keyStart, keyEnd)) as string, keyStart, keyEnd, value });
        i = skip(text, value.end);
      } else {
        i = skip(text, node(text, i).end);
      }
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === close) return { start, end: i + 1, ...(c === "{" ? { members } : {}) };
      throw new SyntaxError(`expected "," or "${close}" at ${i}`);
    }
  }
  let end = start;
  while (end < text.length && !WS.has(text[end]) && !",}]".includes(text[end])) end++;
  if (end === start) throw new SyntaxError(`expected a value at ${start}`);
  return { start, end };
}

/** Where every value in a JSON text sits. Throws on text that isn't JSON. */
export function locate(text: string): JsonNode {
  JSON.parse(text);
  return node(text, 0);
}

/** The object at a path of keys, or undefined when a key is missing or isn't an object. */
export function objectAt(root: JsonNode, path: string[]): JsonNode | undefined {
  let current: JsonNode | undefined = root;
  for (const key of path) {
    current = current?.members?.find((m) => m.key === key)?.value;
  }
  return current?.members ? current : undefined;
}

const splice = (text: string, from: number, to: number, insert: string) => text.slice(0, from) + insert + text.slice(to);

/**
 * Set one key of an object. An existing key keeps its place and only its value changes; a new key
 * goes right after `after` (or last), with the same spacing the object already uses between keys.
 */
export function setMember(text: string, object: JsonNode, key: string, value: unknown, after?: string): string {
  const members = object.members ?? [];
  const json = JSON.stringify(value);
  const existing = members.find((m) => m.key === key);
  if (existing) return splice(text, existing.value.start, existing.value.end, json);
  if (members.length === 0) return splice(text, object.start + 1, object.end - 1, `${JSON.stringify(key)}: ${json}`);

  const at = Math.max(0, after === undefined ? members.length - 1 : members.findIndex((m) => m.key === after));
  const anchor = members[at] ?? members[members.length - 1];
  // The whitespace in front of a key: the gap after the comma between two keys, or after the opening brace.
  const gap = (i: number) => {
    const from = i === 0 ? object.start + 1 : text.indexOf(",", members[i - 1].value.end) + 1;
    return text.slice(from, members[i].keyStart);
  };
  const lead = members.length > 1 ? gap(at + 1 < members.length ? at + 1 : at) : gap(0);
  const colon = text.slice(anchor.keyEnd, anchor.value.start);
  return splice(text, anchor.value.end, anchor.value.end, `,${lead}${JSON.stringify(key)}${colon}${json}`);
}

/** Remove one key of an object with the comma that joined it to its neighbor. Unchanged when the key isn't there. */
export function removeMember(text: string, object: JsonNode, key: string): string {
  const members = object.members ?? [];
  const i = members.findIndex((m) => m.key === key);
  if (i < 0) return text;
  if (i > 0) return splice(text, members[i - 1].value.end, members[i].value.end, "");
  if (members.length > 1) return splice(text, members[0].keyStart, members[1].keyStart, "");
  return splice(text, object.start + 1, object.end - 1, "");
}
