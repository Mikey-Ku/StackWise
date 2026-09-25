import { projectCatalog } from "./lib";

/**
 * pnpm eval:questions
 *
 * The question ids an eval case can grade, with the question each one asks, so writing
 * `expected` in evals/prefill-cases.json doesn't mean reading data/needs.json. No AI, no network.
 */
const { needs } = projectCatalog();
const width = Math.max(...needs.map((n) => n.id.length));
console.log(needs.map((n) => `${n.id.padEnd(width)}  ${n.question}`).join("\n"));
