import { axe, type JestAxeConfigureOptions } from "jest-axe";
import { expect } from "vitest";

// Shared axe run for component tests (see docs/TESTING.md's accessibility
// section). jest-axe disables `color-contrast` by default (jsdom doesn't do
// real layout/paint, so axe can't reliably read computed styles/visibility
// for that rule) -- restated explicitly here so it stays disabled even if
// that default ever changes upstream. Contrast itself is checked manually
// against the Tailwind palette (see apps/web/tailwind.config.ts) and during
// the manual dev-server pass in coordination/status/07-frontend-tests.md.
// Every other rule (labels, roles, alt text, focus order, aria-*) runs for
// real.
const AXE_OPTIONS: JestAxeConfigureOptions = {
  rules: {
    "color-contrast": { enabled: false },
  },
};

export async function checkA11y(container: Element): Promise<void> {
  const results = await axe(container, AXE_OPTIONS);
  expect(results).toHaveNoViolations();
}
