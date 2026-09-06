import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Lets tests under repo-root tests/unit/agent|tests/integration/agent
      // import source with a clean specifier (`@agent/engine/foo.js`)
      // instead of a pile of "../../../.." -- see docs/TESTING.md.
      "@agent": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    root,
    environment: "node",
    // Test files live in the mirrored tree under the repo-root
    // `tests/unit/agent/` and `tests/integration/agent/` -- see
    // docs/TESTING.md for the convention. No colocated `*.test.ts` files
    // next to source, so there's exactly one place to look.
    include: ["../../tests/unit/agent/**/*.test.ts", "../../tests/integration/agent/**/*.test.ts"],
  },
});
