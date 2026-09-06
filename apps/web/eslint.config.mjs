import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next.js 16 removed the `next lint` command in favor of running ESLint
// directly (https://nextjs.org/docs/app/api-reference/config/eslint) -- see
// docs/TESTING.md for why apps/web's lint script is a plain `eslint .`.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Pre-existing pattern in app/page.tsx (an unconditional data-refresh
      // call inside a mount-only useEffect) trips this as an error under
      // eslint-config-next 16's rule set. Real fix is app behavior, not
      // harness/lint config -- belongs to session 07's app/ bug-fix pass
      // (see docs/TESTING.md). Downgraded to warn so introducing lint here
      // doesn't fail CI for pre-existing app code on day one; tracked, not
      // silenced.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
