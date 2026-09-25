import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // next dev would otherwise write its own AGENTS.md and CLAUDE.md blocks into this repo.
  agentRules: false,
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
