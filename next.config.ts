import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Mac app runs the built site as a standalone server (electron/main.cjs). pnpm build stays as it is.
  ...(process.env.STACKWISE_STANDALONE
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: __dirname,
        // Next copies into the standalone every file a page's fs reads can be traced to. A read whose
        // folder it can't evaluate (a project folder, the home folder) becomes a `**/<file>` glob over
        // this repo, which matched the copies of data/ inside release/ (the last app build), the empty
        // .git and the old .stackwise. None of that belongs in the app; pack.cjs copies data/ itself.
        outputFileTracingExcludes: { "*": [".git/**", "**/.git", "release/**", ".stackwise/**"] },
      }
    : {}),
  devIndicators: false,
  // next dev would otherwise write its own AGENTS.md and CLAUDE.md blocks into this repo.
  agentRules: false,
  // The applications page became Projects; Learn joined the Documentation page (the hash, #part-<id> or #term-<id>, comes along).
  async redirects() {
    return [
      { source: "/apps", destination: "/projects", permanent: true },
      { source: "/learn", destination: "/docs", permanent: true },
    ];
  },
  // No other site may show StackWise in a frame: a page could otherwise trick clicks on Start or Export.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
