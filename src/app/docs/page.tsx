import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { Marked, type Tokens } from "marked";
import { loadCatalog } from "@/engine/load";
import { readMe } from "@/local/home";
import DocsView, { type Doc, type LearnContent, type LearnPart, type LearnTerm } from "./DocsView";
import "../shell.css";
import "./docs.css";

export const metadata: Metadata = {
  title: "Documentation | StackWise",
  description: "How a web app fits together, in plain words: every part, how to choose one, the mistakes beginners make, a glossary. Then StackWise's own docs: the overview, the MCP tools, the facts and rules, the decisions and the demo.",
};

// The docs are files in the repo (data/learn.json, the Markdown); read them on every request so an edit shows on refresh.
export const dynamic = "force-dynamic";

/**
 * Where the Markdown is: the working folder (the repo, or the standalone folder in the Mac app,
 * where pack.cjs copies the files). Written this way on purpose: Next's output file tracing
 * follows every `fs.readFileSync(path.join(process.cwd(), ...))` it can evaluate, and with a
 * variable file name it traced the whole working folder into the standalone build (the git
 * history, the last dmg, private notes). A plain `a || process.cwd()` was folded back to
 * `process.cwd()` by the bundler; a lookup in an array is something neither it nor the tracer
 * evaluates, so the read traces nothing and pack.cjs copies the files itself.
 */
const docsRoot = () => [process.env.STACKWISE_DOCS_ROOT, process.cwd()].find(Boolean) as string;

/** The project's documents, in reading order. Each is a Markdown file in the repo, shown as one section. */
const DOCS: { id: string; title: string; file: string }[] = [
  { id: "overview", title: "Overview", file: "README.md" },
  { id: "mcp", title: "MCP and agents", file: "docs/MCP.md" },
  { id: "data", title: "Facts and rules", file: "docs/DATA.md" },
  { id: "how", title: "How it works", file: "docs/LEARNING.md" },
  { id: "decisions", title: "Decisions", file: "docs/DECISIONS.md" },
  { id: "demo", title: "The demo", file: "docs/DEMO.md" },
];

const REPO = "https://github.com/Mikey-Ku/StackWise";
const RAW = "https://raw.githubusercontent.com/Mikey-Ku/StackWise/main";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * A link inside a doc: another doc becomes its section here (its own anchors too), a repo file
 * opens on GitHub, the web stays the web. Heading ids carry the document's id, so a `#heading`
 * link inside a document points at that document's heading.
 */
function rewriteHref(href: string, from: string): string {
  if (/^(https?:|mailto:)/.test(href)) return href;
  const [file, anchor] = href.split("#");
  if (!file) return `#${from}-${anchor ?? ""}`;
  const clean = file.replace(/^(\.\.?\/)+/, "");
  const doc = DOCS.find((d) => d.file === clean || d.file === `docs/${clean}`);
  if (doc) return `/docs#${anchor ? `${doc.id}-${anchor}` : doc.id}`;
  return `${REPO}/blob/main/${clean.replace(/^\//, "")}`;
}

/** An image in a doc: the app's own icon is served by the app; anything else in the repo comes from GitHub. */
const imageSrc = (href: string) => (/^(https?:|data:)/.test(href) ? href : href.replace(/^\.?\//, "") === "src/app/icon.svg" ? "/icon.svg" : `${RAW}/${href.replace(/^\.?\//, "")}`);

function render(id: string, markdown: string): { html: string; headings: { id: string; text: string }[] } {
  const headings: { id: string; text: string }[] = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens);
        const anchor = `${id}-${slug(text)}`;
        if (depth === 2) headings.push({ id: anchor, text: text.replace(/<[^>]+>/g, "") });
        // The file's own title is the section's title in the sidebar; inside, start one level down.
        const level = Math.min(6, depth + 1);
        return `<h${level} id="${anchor}">${text}</h${level}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        const to = rewriteHref(href, id);
        const external = /^https?:/.test(to);
        return `<a href="${to}"${title ? ` title="${title}"` : ""}${external ? ' target="_blank" rel="noreferrer"' : ""}>${text}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        return `<img src="${imageSrc(href)}" alt="${text}"${title ? ` title="${title}"` : ""} loading="lazy">`;
      },
    },
  });
  // GitHub's <picture> blocks (light and dark screenshots) are plain HTML in the file: keep the
  // light one. Raw <img> tags point at files in the repo too, so their src gets the same treatment.
  const source = markdown
    .replace(/<picture>[\s\S]*?(<img [^>]*>)[\s\S]*?<\/picture>/g, "$1")
    .replace(/(<img [^>]*?src=")([^"]+)(")/g, (_m, before: string, src: string, after: string) => `${before}${imageSrc(src)}${after}`);
  const html = marked.parse(source) as string;
  return { html, headings };
}

/** The teaching content from data/learn.json: the layers to start with, one entry per part, the glossary. */
function learnContent(): LearnContent {
  const catalog = loadCatalog();
  const { learn } = catalog;
  const parts: LearnPart[] = catalog.slots.flatMap((slot) => {
    const entry = learn.slots[slot.id];
    return entry ? [{ id: slot.id, label: slot.label, ...entry }] : [];
  });
  // Each term lists the parts that use it, so the glossary links back to them.
  const terms: LearnTerm[] = Object.entries(learn.terms)
    .map(([id, t]) => ({ id, ...t, usedIn: parts.filter((p) => p.terms.includes(id)).map((p) => ({ id: p.id, label: p.label })) }))
    .sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }));
  return { startHere: learn.start_here ?? null, parts, terms };
}

export default function DocsPage() {
  const docs: Doc[] = DOCS.flatMap((doc) => {
    let text: string;
    try {
      text = fs.readFileSync(path.join(docsRoot(), doc.file), "utf8");
    } catch {
      return [];
    }
    const { html, headings } = render(doc.id, text);
    return [{ id: doc.id, title: doc.title, file: doc.file, html, headings }];
  });
  return <DocsView me={readMe()} learn={learnContent()} docs={docs} repo={REPO} />;
}
