/**
 * StackWise's names on disk and in the environment. It was called WhyStack early on, so each name
 * here still reads its old form: nothing saved under the old name is lost.
 */

export const PLAN_FILE = "stackwise.plan.json";
export const LEGACY_PLAN_FILE = "whystack.plan.json";

/** Shared plans, the server log and the launch token live here, in StackWise's own folder (gitignored). */
export const STATE_DIR = ".stackwise";
export const LEGACY_STATE_DIR = ".whystack";

/** A setting from the environment: STACKWISE_<name>, or the old WHYSTACK_<name>. */
export function setting(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return env[`STACKWISE_${name}`] ?? env[`WHYSTACK_${name}`];
}
