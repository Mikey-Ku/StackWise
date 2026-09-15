import fs from "node:fs";
import path from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_EFFORT, AI_MODEL, FALLBACK_BETA, getClient } from "@/ai/config";
import { checkCatalog } from "@/engine/integrity";
import type { Option } from "@/engine/schema";
import { todayIso } from "@/engine/staleness";
import { ROOT, args, htmlToText, projectCatalog, requireAi, writeReport } from "./lib";
import { CHECK_SYSTEM, applyChecks, changesMarkdown, checkPrompt, checkSchema, claimsBySource, type Change } from "./source-check-core";

/**
 * pnpm check:sources [--option <id>] [--limit <pages>] [--apply]
 *
 * Rereads the page behind each fact and asks Claude whether it still says the same thing.
 * Without --apply it only writes a report. With --apply it also edits data/options: confirmed
 * facts get today's date, contradicted facts get the corrected value and go back to draft. The
 * weekly GitHub workflow runs it with --apply and opens a pull request, so a person always reviews.
 */

const MAX_PAGE_CHARS = 400_000;

async function readPage(url: string): Promise<{ text: string } | { error: string }> {
  try {
    const response = await fetch(url, { headers: { "user-agent": "WhyStack source checker (+https://github.com/Mikey-Ku/whystack)" }, redirect: "follow" });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const text = htmlToText(await response.text());
    if (text.length < 200) return { error: "almost no readable text (the page probably needs JavaScript)" };
    if (text.length > MAX_PAGE_CHARS) return { error: `page text is ${text.length} characters, too large to check in one request` };
    return { text };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

async function main() {
  requireAi();
  const flags = args();
  const catalog = projectCatalog();
  const today = todayIso();
  const limit = Number(flags.limit ?? Infinity);
  const groups = [...claimsBySource(catalog, { optionId: typeof flags.option === "string" ? flags.option : undefined })].slice(0, limit);
  const options = new Map(catalog.options.map((o) => [o.id, structuredClone(o)]));
  const client = getClient();
  const changes: Change[] = [];
  const skipped: { url: string; reason: string }[] = [];

  for (const [url, claims] of groups) {
    process.stdout.write(`${url} (${claims.length} facts)... `);
    const page = await readPage(url);
    if ("error" in page) {
      skipped.push({ url, reason: page.error });
      console.log(`skipped: ${page.error}`);
      continue;
    }
    const response = await client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: AI_EFFORT, format: betaZodOutputFormat(checkSchema(claims.map((c) => c.key))) },
      system: CHECK_SYSTEM,
      messages: [{ role: "user", content: checkPrompt(catalog, url, page.text, claims) }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      skipped.push({ url, reason: "no usable answer from Claude" });
      console.log("skipped: no usable answer");
      continue;
    }
    const pageChanges = applyChecks(catalog, options, response.parsed_output, today);
    changes.push(...pageChanges);
    console.log(pageChanges.map((c) => c.kind).join(", ") || "nothing to change");
  }

  if (flags.apply) {
    const problems = checkCatalog({ ...catalog, options: [...options.values()] });
    if (problems.length) {
      console.error(`Not applying: the result would break the data checks.\n${problems.join("\n")}`);
      process.exit(1);
    }
    for (const option of options.values()) {
      const original = catalog.options.find((o) => o.id === option.id) as Option;
      if (JSON.stringify(original) === JSON.stringify(option)) continue;
      fs.writeFileSync(path.join(ROOT, "data", "options", `${option.id}.json`), `${JSON.stringify(option, null, 2)}\n`);
    }
  }

  const markdown = changesMarkdown(today, changes, skipped);
  const report = writeReport(`source-check-${today}.md`, markdown);
  writeReport("source-check-latest.md", markdown);
  console.log(`\n${markdown.split("\n")[2]}\nReport: ${report}${flags.apply ? "" : " (dry run; pass --apply to edit the data)"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
