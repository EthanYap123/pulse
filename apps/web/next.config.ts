import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The browser only talks to this origin; /api/* is proxied to the Fastify API
  // so the refresh-token cookie stays first-party (docs/ARCHITECTURE.md §2).
  rewrites: () => Promise.resolve([{ source: "/api/:path*", destination: `${apiUrl}/:path*` }]),
};

export default nextConfig;
