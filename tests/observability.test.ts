import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Sentry is initialized for server, edge, and browser without default PII", () => {
  const pkg = JSON.parse(readFileSync(new URL("../apps/web/package.json", import.meta.url), "utf8"));
  const instrumentation = readFileSync(new URL("../apps/web/instrumentation.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../apps/web/instrumentation-client.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../apps/web/sentry.server.config.ts", import.meta.url), "utf8");
  const edge = readFileSync(new URL("../apps/web/sentry.edge.config.ts", import.meta.url), "utf8");
  assert.match(pkg.dependencies["@sentry/nextjs"], /^\^10\./);
  assert.match(instrumentation, /sentry\.server\.config/);
  assert.match(instrumentation, /sentry\.edge\.config/);
  for (const source of [client, server, edge]) {
    assert.match(source, /sendDefaultPii:\s*false/);
    assert.match(source, /release:/);
  }
});

test("Next.js captures request errors and uploads release source maps", () => {
  const instrumentation = readFileSync(new URL("../apps/web/instrumentation.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../apps/web/next.config.ts", import.meta.url), "utf8");
  assert.match(instrumentation, /onRequestError/);
  assert.match(config, /withSentryConfig/);
  assert.match(config, /deleteSourcemapsAfterUpload/);
});

test("PostHog page views do not read request search params during prerender", () => {
  const provider = readFileSync(
    new URL("../apps/web/components/providers/posthog-provider.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(provider, /useSearchParams/);
  assert.match(provider, /window\.location\.search/);
});

test("the App Router global error boundary reports render failures", () => {
  const globalError = readFileSync(new URL("../apps/web/app/global-error.tsx", import.meta.url), "utf8");
  assert.match(globalError, /Sentry\.captureException\(error\)/);
  assert.match(globalError, /reset/);
});
