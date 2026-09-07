// jest-axe ships Jest-namespace types (via @types/jest-axe) but no Vitest
// `Assertion` augmentation for its `toHaveNoViolations` matcher -- add our
// own so `expect(results).toHaveNoViolations()` (registered in
// tests/unit/web/setup.ts, used via tests/unit/web/a11y.ts) type-checks.
import "vitest";

declare module "vitest" {
  interface Assertion {
    toHaveNoViolations(): void;
  }
}
