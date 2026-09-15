import { z } from "zod";

/**
 * Everything WhyStack knows lives in /data as JSON. These schemas are the contract for those
 * files: the app refuses to start on a file that breaks them, and the data tests run them in CI.
 */

export const SLOT_IDS = ["framework", "hosting", "domain", "database", "login", "files", "payments", "ai", "scraping", "jobs", "email", "analytics", "monitoring", "mobile"] as const;
export const slotIdSchema = z.enum(SLOT_IDS);
export type SlotId = z.infer<typeof slotIdSchema>;

export const SIZE_IDS = ["just_me", "up_to_100", "up_to_1000", "more"] as const;
export type SizeId = (typeof SIZE_IDS)[number];

export const PRIORITY_IDS = ["spend_zero", "launch_fast", "learn", "ready_to_grow"] as const;
export type PriorityId = (typeof PRIORITY_IDS)[number];

const httpUrl = z.string().regex(/^https?:\/\/\S+$/, "must be an http(s) URL");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date");

export const factValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.string()),
  z.null(),
]);
export type FactValue = z.infer<typeof factValueSchema>;

export const factSchema = z.object({
  value: factValueSchema,
  note: z.string().min(1),
  source: httpUrl,
  retrieved: isoDate,
  /** "draft" until a human has checked the fact against its source. */
  status: z.enum(["draft", "verified"]),
});
export type Fact = z.infer<typeof factSchema>;

export const optionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "ids are lowercase letters, digits and dashes"),
  name: z.string().min(1),
  provider: z.string().min(1),
  slots: z.array(slotIdSchema).min(1),
  summary: z.string().min(1),
  website: httpUrl,
  /** "full" promises every fact its slots require; "partial" shows as "not verified yet". */
  coverage: z.enum(["full", "partial"]),
  facts: z.record(z.string(), factSchema),
  setup: z.array(z.object({ step: z.string().min(1), env: z.array(z.string()), source: z.string() })),
  builder_notes: z.array(z.string()),
});
export type Option = z.infer<typeof optionSchema>;

export const factDefSchema = z.object({
  label: z.string(),
  help: z.string(),
  type: z.enum(["enum", "boolean", "number", "number_or_null", "string", "framework_map"]),
  values: z.array(z.string()).optional(),
});
export type FactDef = z.infer<typeof factDefSchema>;

export const slotDefSchema = z.object({
  id: slotIdSchema,
  label: z.string(),
  verb: z.string(),
  empty_hint: z.string(),
  required_facts: z.array(z.string()),
  build_task: z.string(),
});
export type SlotDef = z.infer<typeof slotDefSchema>;

export const needSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  label: z.string(),
  question: z.string(),
  why: z.string(),
  keywords: z.array(z.string()),
  adds_slots: z.array(slotIdSchema),
  only_if: z.string().optional(),
  not_sure_note: z.string(),
});
export type Need = z.infer<typeof needSchema>;

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
type Scalar = z.infer<typeof scalarSchema>;

export const conditionSchema = z
  .object({
    slot: slotIdSchema,
    /** The fact to read. Left out when the condition only asks whether the slot is filled. */
    fact: z.string().optional(),
    /** Read the fact as a map and look up the id of the option in this other slot. */
    key_from_slot: slotIdSchema.optional(),
    is: scalarSchema.optional(),
    in: z.array(scalarSchema).optional(),
    not: scalarSchema.optional(),
    /** true: something is in the slot. false: the slot is empty. Reads no facts. */
    filled: z.boolean().optional(),
  })
  .refine(
    (c) =>
      c.filled !== undefined
        ? c.fact === undefined && c.is === undefined && c.in === undefined && c.not === undefined && c.key_from_slot === undefined
        : c.fact !== undefined && [c.is, c.in, c.not].filter((v) => v !== undefined).length === 1,
    { message: "a condition is either { slot, filled } or { slot, fact } with exactly one of is, in, not" },
  );
export type Condition = z.infer<typeof conditionSchema> & { is?: Scalar; in?: Scalar[]; not?: Scalar };

const ruleText = {
  title: z.string(),
  explanation: z.string(),
  fix: z.string().optional(),
  builder: z.string().optional(),
  /** Sources for numbers or claims written into the rule text itself. */
  sources: z.array(httpUrl).optional(),
};

export const capabilityRuleSchema = z.object({
  id: z.string(),
  severity: z.enum(["blocked", "warning", "info"]),
  needs: z.array(z.string()),
  when: z.array(conditionSchema).min(1),
  ...ruleText,
});
export type CapabilityRule = z.infer<typeof capabilityRuleSchema>;

export const productRuleSchema = z.object({
  id: z.string(),
  /**
   * There is deliberately no "works" severity. A product rule can add a block, a warning or a
   * note, but it can never cancel what a capability rule decided. If a capability rule blocks a
   * pair that really works, a fact is wrong, and the fix belongs in the facts.
   */
  severity: z.enum(["blocked", "warning", "info"]),
  needs: z.array(z.string()),
  pair: z.tuple([
    z.object({ slot: slotIdSchema, option: z.string() }),
    z.object({ slot: slotIdSchema, option: z.string() }),
  ]),
  ...ruleText,
});
export type ProductRule = z.infer<typeof productRuleSchema>;

const weightsSchema = z.object({
  cost: z.number(),
  price: z.number(),
  setup: z.number(),
  portability: z.number(),
  accounts: z.number(),
});
export type Weights = z.infer<typeof weightsSchema>;

export const planningSchema = z.object({
  sizes: z.array(z.object({ id: z.enum(SIZE_IDS), label: z.string() })),
  priorities: z.array(z.object({ id: z.enum(PRIORITY_IDS), label: z.string(), help: z.string(), weights: weightsSchema })),
  builders: z.array(z.object({ id: z.string(), label: z.string(), format: z.enum(["prompt", "claude-md", "agents-md"]) })),
  penalties: z.object({ warning: z.number(), unknown: z.number(), info_bonus: z.number() }),
  close_call_margin: z.number(),
  no_account_providers: z.array(z.string()),
  /** Costs that come with a part no matter which option fills it, like app store developer accounts. */
  fees: z
    .array(z.object({ id: z.string(), slot: slotIdSchema, label: z.string(), usd: z.number().min(0), per: z.enum(["year", "once"]), source: httpUrl }))
    .default([]),
  /** Providers whose one paid plan covers every part they fill, so the plan is counted once. */
  shared_plans: z.array(z.object({ provider: z.string(), note: z.string(), source: httpUrl })).default([]),
});
export type Planning = z.infer<typeof planningSchema>;
export type Fee = Planning["fees"][number];

export const learnSchema = z.object({
  // Partial so a new part can be added before its teaching content; the data checks report the gap.
  slots: z.partialRecord(
    slotIdSchema,
    z.object({
      what: z.string(),
      why: z.string(),
      choosing: z.array(z.string()),
      watch_for: z.array(z.string()),
      terms: z.array(z.string()),
    }),
  ),
  terms: z.record(z.string(), z.object({ term: z.string(), plain: z.string(), matters: z.string() })),
});
export type Learn = z.infer<typeof learnSchema>;

/**
 * Where each option's logo comes from: a Simple Icons slug or the service's own website. `file` and
 * `source` are filled in by scripts/build-logos.ts once the file is in public/logos.
 */
const logoFile = z.string().regex(/^[a-z0-9-]+\.(svg|png|ico|webp|jpg)$/);
export const logoSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("simple-icons"), slug: z.string().min(1), file: logoFile.optional(), source: httpUrl.optional() }),
  z.object({ from: z.literal("site"), url: httpUrl, file: logoFile.optional(), source: httpUrl.optional() }),
]);
export type Logo = z.infer<typeof logoSchema>;

export interface Catalog {
  slots: SlotDef[];
  facts: Record<string, FactDef>;
  needs: Need[];
  options: Option[];
  capabilityRules: CapabilityRule[];
  productRules: ProductRule[];
  planning: Planning;
  learn: Learn;
  logos: Record<string, Logo>;
}

export type Answer = "yes" | "no" | "not_sure";

/** What the beginner told the planner. */
export interface PlanInput {
  answers: Record<string, Answer>;
  size: SizeId;
  priority: PriorityId;
}

/** Which option sits in each slot. An empty string means the person cleared that slot on purpose. */
export type Selection = Partial<Record<SlotId, string>>;
