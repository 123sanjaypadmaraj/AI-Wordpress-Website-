import "@testing-library/jest-dom/vitest";
import { toHaveNoViolations } from "jest-axe";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";

// jsdom doesn't implement scrollIntoView (it does no layout at all) -- several
// components (e.g. ChatPanel, which auto-scrolls to the latest message) call
// it unconditionally in a real browser. Stub it so those effects don't throw
// here; this is a jsdom gap, not something under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Adds jest-axe's `expect(results).toHaveNoViolations()` matcher (see
// tests/unit/web/a11y.ts for the shared `checkA11y` helper built on it).
// `toHaveNoViolations` here is already the full matchers object (jest-axe's
// own `jest-axe/extend-expect` entry point does the same
// `expect.extend(toHaveNoViolations)`, unwrapped) -- wrapping it again in an
// object literal double-nests it under its own key and silently breaks it.
expect.extend(toHaveNoViolations);

// Testing Library doesn't unmount components between tests on its own --
// without this, rendered DOM from one test bleeds into the next.
afterEach(() => {
  cleanup();
});
