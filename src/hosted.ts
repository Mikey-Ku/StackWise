import { setting } from "@/engine/names";

/**
 * The public, hosted StackWise: built with NEXT_PUBLIC_STACKWISE_HOSTED=1 (see README). It's the
 * planner, the canvas, Learn and the export as a zip, with plans kept in each visitor's browser.
 * Everything that reaches into a computer (a project folder, writing files, saving keys, pairing
 * with a terminal agent, the MCP server) is off, because a hosted server has no computer of the
 * visitor's to reach and no accounts to say whose request is whose.
 */
export const HOSTED = process.env.NEXT_PUBLIC_STACKWISE_HOSTED === "1";

/** Where to get StackWise to run on your own computer. */
export const SOURCE_URL = "https://github.com/Mikey-Ku/StackWise";

type Env = Record<string, string | undefined>;

/**
 * Whether the built-in AI may spend a key's credit. STACKWISE_AI=off turns it off anywhere. A
 * hosted copy leaves it off even with a key set, since anyone on the internet could spend it;
 * STACKWISE_HOSTED_AI=on is the owner saying they accept that (the hourly limit still applies).
 */
export function aiAllowed(env: Env = process.env): boolean {
  if (setting("AI", env) === "off") return false;
  if (env.NEXT_PUBLIC_STACKWISE_HOSTED === "1" && setting("HOSTED_AI", env) !== "on") return false;
  return true;
}
