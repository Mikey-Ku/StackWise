import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { valueMatches } from "@/engine/integrity";
import { factDefSchema, optionSchema, slotDefSchema } from "@/engine/schema";
import { ROOT, args } from "./lib";

/**
 * pnpm check:options -- --id firecrawl,apify
 *
 * Checks single option files while you write them, without loading the rest of the catalog: the
 * schema, every fact against facts.json, full coverage against each slot's required facts, and
 * em dashes. `pnpm check:data` still runs every cross-file check before a pull request.
 */

function main() {
  const ids = String(args().id ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    console.error("Usage: pnpm check:options -- --id <id>[,<id>...]");
    process.exit(1);
  }
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", file), "utf8"));
  const facts = z.record(z.string(), factDefSchema).parse(read("facts.json"));
  const slots = z.array(slotDefSchema).parse(read("slots.json"));
  const frameworkIds = fs
    .readdirSync(path.join(ROOT, "data", "options"))
    .map((f) => read(`options/${f}`) as { id: string; slots: string[] })
    .filter((o) => o.slots.includes("framework"))
    .map((o) => o.id);

  let failed = false;
  for (const id of ids) {
    const problems: string[] = [];
    const file = `options/${id}.json`;
    let raw: unknown;
    try {
      raw = read(file);
    } catch (error) {
      console.log(`${id}: can't read data/${file} (${(error as Error).message})`);
      failed = true;
      continue;
    }
    const parsed = optionSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(...parsed.error.issues.map((i) => `schema: ${i.path.join(".")}: ${i.message}`));
    } else {
      const option = parsed.data;
      if (option.id !== id) problems.push(`id "${option.id}" doesn't match the file name`);
      for (const [key, fact] of Object.entries(option.facts)) {
        const def = facts[key];
        if (!def) problems.push(`unknown fact "${key}"`);
        else if (!valueMatches(def, fact.value, frameworkIds)) problems.push(`"${key}" has an invalid value ${JSON.stringify(fact.value)}`);
      }
      if (option.coverage === "full") {
        for (const slot of option.slots) {
          for (const key of slots.find((s) => s.id === slot)?.required_facts ?? []) {
            const fact = option.facts[key];
            if (!fact) problems.push(`full coverage but missing "${key}" for ${slot}`);
            else if (fact.value === null && facts[key]?.type !== "number_or_null") problems.push(`full coverage but "${key}" is null`);
          }
        }
      }
    }
    if (JSON.stringify(raw).includes("\\u2014") || JSON.stringify(raw).includes("—")) problems.push("contains an em dash");
    console.log(problems.length ? `${id}: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n  ${problems.join("\n  ")}` : `${id}: ok`);
    failed ||= problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
}

main();
