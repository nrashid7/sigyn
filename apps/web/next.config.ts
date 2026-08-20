import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
import { SECURITY_HEADERS } from "./lib/server/security-headers";
import { withSentryConfig } from "@sentry/nextjs";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@businessvoice/shared"],
  turbopack: {
    root: rootDir,
  },
  async headers() {
    return [{ source: "/(.*)", headers: [...SECURITY_HEADERS] }];
  },
};

const sentryConfig = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});

export default sentryConfig;
