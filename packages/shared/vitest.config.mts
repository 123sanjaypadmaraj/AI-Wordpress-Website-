import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Keep `root` pinned to this package directory so relative includes below
// resolve predictably regardless of where `vitest`/`npm run` is invoked from.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    root,
    environment: "node",
    // Test files live in the mirrored tree under the repo-root
    // `tests/unit/shared/` and `tests/integration/shared/` -- see
    // docs/TESTING.md for the convention. No colocated `*.test.ts` files
    // next to source, so there's exactly one place to look.
    include: ["../../tests/unit/shared/**/*.test.ts", "../../tests/integration/shared/**/*.test.ts"],
  },
});
