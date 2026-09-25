import path from "node:path";
import { z } from "zod";
import { defaultPlans } from "@/components/defaultPlans";
import { indexCatalog } from "@/engine/evaluate";
import { loadCatalog } from "@/engine/load";
import { STATE_DIR } from "@/engine/names";
import { reviewCounts, reviewList } from "@/engine/review";
import { applyReview, COMMENT_MAX, FACT_KEY, OPTION_ID, readFlags, reviewHidden } from "@/engine/review-store";
import { localOnly, readJson } from "@/mcp/local";

/**
 * The fact review (/review). GET lists the facts to check, the ones behind the default plans
 * first, with the flags left so far. POST records one decision: "confirm" marks the fact verified
 * in its option file with today's date; "flag" keeps it a draft and logs the comment in
 * .stackwise/review-flags.json. Answers this computer only, and doesn't exist on a hosted
 * StackWise (STACKWISE_HOSTED=1).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const notFound = () => Response.json({ error: "Not found." }, { status: 404 });
const dataDir = () => path.join(process.cwd(), "data");
const stateDir = () => path.join(process.cwd(), STATE_DIR);

/** The reviewer's date, in this computer's time zone. */
function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function GET(request: Request) {
  if (reviewHidden()) return notFound();
  const blocked = localOnly(request);
  if (blocked) return blocked;

  const catalog = loadCatalog(dataDir());
  const flags = readFlags(stateDir());
  const defaults = defaultPlans();
  const items = reviewList(indexCatalog(catalog), defaults).map((item) => (flags[item.key] ? { ...item, flag: flags[item.key] } : item));
  const logos = Object.fromEntries([...new Set(items.map((i) => i.optionId))].flatMap((id) => (catalog.logos[id] ? [[id, catalog.logos[id]]] : [])));
  return Response.json({
    items,
    counts: { ...reviewCounts(items), flagged: items.filter((i) => "flag" in i).length },
    defaults: defaults.map((d) => d.label),
    logos,
  });
}

const bodySchema = z.object({
  optionId: z.string().regex(OPTION_ID),
  fact: z.string().regex(FACT_KEY),
  decision: z.enum(["confirm", "flag"]),
  comment: z.string().max(COMMENT_MAX).optional(),
});

export async function POST(request: Request) {
  if (reviewHidden()) return notFound();
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await readJson(request, 16 * 1024));
  if (!parsed.success) return Response.json({ error: 'Send { optionId, fact, decision: "confirm" | "flag", comment? }.' }, { status: 400 });

  // Only facts StackWise loads can be reviewed: the id and key must be in the catalog, not just on disk.
  const option = loadCatalog(dataDir()).options.find((o) => o.id === parsed.data.optionId);
  if (!option) return Response.json({ error: `No option "${parsed.data.optionId}".` }, { status: 404 });
  if (!Object.hasOwn(option.facts, parsed.data.fact)) return Response.json({ error: `${option.name} has no fact "${parsed.data.fact}".` }, { status: 404 });

  const result = applyReview(dataDir(), stateDir(), parsed.data, localToday());
  if (!result.ok) return Response.json({ error: result.error }, { status: result.code });
  return Response.json(result);
}
