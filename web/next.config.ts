import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Lets the dev server serve its scripts to Codespaces' forwarded address. */
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.app.github.dev"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;