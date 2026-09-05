import { defineConfig } from "@playwright/test";

/**
 * TST-01: standalone Playwright suite for CI / manual runs against an
 * already-running generated site. The pipeline's own equivalent smoke check
 * (TST-02) runs inline via apps/agent/src/engine/testRunner.ts during the
 * TESTING state -- same checklist, reused here as a real spec file so it's
 * also runnable on demand:
 *
 *   PREVIEW_URL=http://localhost:8101 npm run test:e2e
 */
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PREVIEW_URL ?? "http://localhost:8100",
    trace: "retain-on-failure",
  },
});
