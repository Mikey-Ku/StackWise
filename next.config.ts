import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // next dev would otherwise write its own AGENTS.md and CLAUDE.md blocks into this repo.
  agentRules: false,
  // Pages and routes read data/ and the logos with fs at request time (page.tsx is force-dynamic), so a
  // host that bundles each route on its own (Vercel) has to be told to ship them along.
  outputFileTracingIncludes: { "/**": ["./data/**/*", "./public/logos/**/*"] },
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
