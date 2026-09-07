import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrors this workspace's own tsconfig.json "@/*" path so tests
      // (which live outside apps/web, under repo-root tests/unit/web/) can
      // import components/app code the same way app code imports itself.
      "@": root,
    },
  },
  test: {
    root,
    environment: "jsdom",
    setupFiles: ["../../tests/unit/web/setup.ts"],
    // Test files live in the mirrored tree under the repo-root
    // `tests/unit/web/` and `tests/integration/web/` -- see
    // docs/TESTING.md for the convention. No colocated `*.test.tsx` files
    // next to source, so there's exactly one place to look.
    include: ["../../tests/unit/web/**/*.test.{ts,tsx}", "../../tests/integration/web/**/*.test.{ts,tsx}"],
  },
});
