import type { Option, SlotDef, SlotId } from "./schema";

/**
 * "Build it yourself": a part the person writes and runs on their own, like an internal database
 * or Python scripts for automations. Each part (except the framework, which is the app itself) has
 * one such option, made here rather than in /data. It has no facts, so every rule that reads it is
 * "unknown", never "works"; it has no price and no account; and StackWise never picks it, because
 * the search only considers fully researched options. The person's note on the part says what it is.
 */

export const OWN_PROVIDER = "you";
const PREFIX = "own-";

export const ownId = (slot: SlotId) => `${PREFIX}${slot}`;
export const isOwn = (id: string | undefined | null): boolean => Boolean(id?.startsWith(PREFIX));

export function ownOption(slot: SlotDef): Option {
  const label = slot.label.toLowerCase();
  return {
    id: ownId(slot.id),
    name: `Your own ${label}`,
    provider: OWN_PROVIDER,
    slots: [slot.id],
    summary: `You build and run the ${label} yourself. StackWise has no facts on it, so nothing that touches it is checked or priced.`,
    website: "",
    coverage: "partial",
    facts: {},
    setup: [],
    builder_notes: [`The ${label} is the person's own code, not a service. Ask them how it works before wiring anything to it, and keep its connection details in environment variables.`],
  };
}

/** One "your own" option for every part but the framework. */
export function ownOptions(slots: SlotDef[]): Option[] {
  return slots.filter((slot) => slot.id !== "framework").map(ownOption);
}

/** The build step for a part: the slot's task with the option's name, or, for your own, building it. */
export function buildTask(def: SlotDef, option: Option): string {
  if (isOwn(option.id)) return `Build your own ${def.label.toLowerCase()} and connect the app to it. SPEC.md lists what it has to handle.`;
  return def.build_task.replaceAll("{option}", option.name);
}
