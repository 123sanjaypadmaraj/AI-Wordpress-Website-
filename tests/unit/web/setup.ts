// Shared Vitest setup for apps/web component tests (jsdom environment).
// Adds jest-dom's DOM matchers (toBeInTheDocument, toHaveTextContent, etc.)
// to Vitest's `expect`, and resets the jsdom document between tests so
// state (rendered DOM, event listeners) never leaks across test files.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
