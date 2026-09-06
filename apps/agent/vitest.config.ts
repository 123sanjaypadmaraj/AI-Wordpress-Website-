import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Minimal scaffold so tests/unit/agent/** is runnable before task
 * 01-test-harness's own vitest setup lands (see
 * coordination/status/04-unit-dispatcher-security.md's Decisions log --
 * reconcile with 01's config/convention at merge rather than duplicate it).
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: ["tests/unit/agent/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
  },
});
