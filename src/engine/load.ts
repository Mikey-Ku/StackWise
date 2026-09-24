import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  capabilityRuleSchema,
  factDefSchema,
  learnSchema,
  logoSchema,
  type Logo,
  needSchema,
  optionSchema,
  planningSchema,
  productRuleSchema,
  slotDefSchema,
  type Catalog,
  type Learn,
} from "./schema";

/** Node-only: reads /data from disk. Never import this from a client component. */

export class CatalogError extends Error {}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new CatalogError(`${file}: ${(error as Error).message}`);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new CatalogError(`data/${label} is invalid:\n${issues}`);
  }
  return result.data;
}

/** Teaching content is optional at load time; the data checks report it if it's missing. */
export const EMPTY_LEARN = { slots: {}, terms: {} } as unknown as Learn;

/** How light a #rrggbb color looks, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** An SVG whose every fill is a near-black color: drawn in the text color instead, so it shows in dark mode. */
export function isDarkMark(svg: string): boolean {
  const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
  return fills.length > 0 && fills.every((fill) => luminance(fill) < 0.05);
}

function markDarkLogos(logos: Record<string, Logo>, logoDir: string): Record<string, Logo> {
  for (const logo of Object.values(logos)) {
    if (!logo.file?.endsWith(".svg")) continue;
    try {
      if (isDarkMark(fs.readFileSync(path.join(logoDir, logo.file), "utf8"))) logo.dark = true;
    } catch {
      // A missing file shows the letter instead.
    }
  }
  return logos;
}

export function loadCatalog(dataDir = path.join(process.cwd(), "data")): Catalog {
  const file = (name: string) => readJson(path.join(dataDir, name));
  const optionDir = path.join(dataDir, "options");
  const learnPath = path.join(dataDir, "learn.json");
  const logosPath = path.join(dataDir, "logos.json");

  return {
    learn: fs.existsSync(learnPath) ? parse(learnSchema, readJson(learnPath), "learn.json") : EMPTY_LEARN,
    logos: fs.existsSync(logosPath) ? markDarkLogos(parse(z.record(z.string(), logoSchema), readJson(logosPath), "logos.json"), path.join(dataDir, "..", "public", "logos")) : {},
    slots: parse(z.array(slotDefSchema), file("slots.json"), "slots.json"),
    facts: parse(z.record(z.string(), factDefSchema), file("facts.json"), "facts.json"),
    needs: parse(z.array(needSchema), file("needs.json"), "needs.json"),
    planning: parse(planningSchema, file("planning.json"), "planning.json"),
    capabilityRules: parse(z.array(capabilityRuleSchema), file("rules/capability.json"), "rules/capability.json"),
    productRules: parse(z.array(productRuleSchema), file("rules/product.json"), "rules/product.json"),
    options: fs
      .readdirSync(optionDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => parse(optionSchema, readJson(path.join(optionDir, name)), `options/${name}`)),
  };
}
