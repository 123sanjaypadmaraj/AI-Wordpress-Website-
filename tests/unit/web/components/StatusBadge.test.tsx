import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/StatusBadge";

/**
 * Harness proof-of-life for apps/web (session 01-test-harness): a real
 * Testing Library render against jsdom, proving Vitest + React + the "@/"
 * alias + jest-dom matchers are wired up end to end for this workspace.
 *
 * This file mirrors apps/web/components/StatusBadge.tsx, per the convention
 * in docs/TESTING.md. Real component coverage (chat panel, theme picker,
 * project list, etc.) belongs to session 07 -- see tests/unit/web/.
 */
describe("StatusBadge", () => {
  it("shows a coarse, human label for a fine-grained project state", () => {
    render(<StatusBadge status="THEME_INSTALLING" />);
    expect(screen.getByText("Installing")).toBeInTheDocument();
  });

  it("collapses several underlying states to the same display label", () => {
    const { unmount } = render(<StatusBadge status="CREATED" />);
    expect(screen.getByText("Planning")).toBeInTheDocument();
    unmount();

    render(<StatusBadge status="THEME_SELECTION" />);
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("falls back to rendering the raw state string for an unrecognized status", () => {
    // @ts-expect-error deliberately passing a status outside ProjectState to prove the fallback branch
    render(<StatusBadge status="SOME_FUTURE_STATE" />);
    expect(screen.getByText("SOME_FUTURE_STATE")).toBeInTheDocument();
  });
});
