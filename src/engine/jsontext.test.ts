import { describe, expect, it } from "vitest";
import { locate, objectAt, removeMember, setMember } from "./jsontext";

/** Editing JSON as text keeps every byte it doesn't need to change. */

const at = (text: string, path: string[]) => objectAt(locate(text), path)!;

describe("jsontext", () => {
  it("finds nested objects, and nothing where a key is missing or isn't an object", () => {
    const text = '{ "a": { "b": { "c": 1 } }, "list": [1, { "x": "}" }], "s": "q\\"uote" }';
    expect(text.slice(at(text, ["a", "b"]).start, at(text, ["a", "b"]).end)).toBe('{ "c": 1 }');
    expect(objectAt(locate(text), ["a", "missing"])).toBeUndefined();
    expect(objectAt(locate(text), ["s"])).toBeUndefined();
    expect(() => locate("{ nope }")).toThrow();
  });

  it("replaces a value in place and adds a key with the object's own spacing", () => {
    const spread = '{\n  "a": 1,\n  "b": 2\n}\n';
    expect(setMember(spread, at(spread, []), "a", "one")).toBe('{\n  "a": "one",\n  "b": 2\n}\n');
    expect(setMember(spread, at(spread, []), "c", true)).toBe('{\n  "a": 1,\n  "b": 2,\n  "c": true\n}\n');
    expect(setMember(spread, at(spread, []), "c", true, "a")).toBe('{\n  "a": 1,\n  "c": true,\n  "b": 2\n}\n');
    const single = '{\n    "only": 1\n}';
    expect(setMember(single, at(single, []), "next", 2)).toBe('{\n    "only": 1,\n    "next": 2\n}');
    expect(setMember("{}", at("{}", []), "k", "v")).toBe('{"k": "v"}');
  });

  it("removes a key with the comma that joined it", () => {
    const text = '{ "a": 1, "b": 2, "c": 3 }';
    expect(removeMember(text, at(text, []), "b")).toBe('{ "a": 1, "c": 3 }');
    expect(removeMember(text, at(text, []), "a")).toBe('{ "b": 2, "c": 3 }');
    expect(removeMember(text, at(text, []), "c")).toBe('{ "a": 1, "b": 2 }');
    expect(removeMember(text, at(text, []), "z")).toBe(text);
  });
});
