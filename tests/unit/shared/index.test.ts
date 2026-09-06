import { describe, expect, it } from "vitest";
import { emptySiteSpecification, EMPTY_SLOTS, PROJECT_STATES, TOOL_PERMISSIONS, TOOL_NAMES } from "@ai-wp/shared";

/**
 * Harness proof-of-life for packages/shared (session 01-test-harness). This
 * package is pure data shapes + a couple of factory helpers -- no I/O, no
 * mocking needed -- so a plain assertion test is enough to prove Vitest is
 * wired up end to end for this workspace, including resolving `@ai-wp/shared`
 * as a package import (the same way apps/agent and apps/web consume it) from
 * outside the package's own directory.
 *
 * This file mirrors packages/shared/src/index.ts, per the convention in
 * docs/TESTING.md. Real coverage of this package's contracts belongs to
 * whichever later session touches them; this file is deliberately small.
 */
describe("emptySiteSpecification", () => {
  it("returns a spec with every required top-level section present", () => {
    const spec = emptySiteSpecification("My Site");

    expect(spec.site.name).toBe("My Site");
    expect(spec.pages).toEqual([]);
    expect(spec.features).toEqual([]);
    expect(spec.theme).toEqual({ selected: null, use_child_theme: true });
    expect(spec.ecommerce).toEqual({ payment: null });
    expect(spec.discoveredSkills).toEqual([]);
  });

  it("defaults design.mode to light and design.radius to soft", () => {
    const spec = emptySiteSpecification();
    expect(spec.design.mode).toBe("light");
    expect(spec.design.radius).toBe("soft");
  });

  it("defaults to a generic project name when none is given", () => {
    expect(emptySiteSpecification().site.name).toBe("Untitled Project");
  });
});

describe("EMPTY_SLOTS", () => {
  it("has every slot unset (null), including array-valued slots", () => {
    for (const value of Object.values(EMPTY_SLOTS)) {
      expect(value).toBeNull();
    }
  });
});

describe("TOOL_PERMISSIONS", () => {
  it("assigns a permission tier to every declared tool name, and no others", () => {
    const declared = Object.keys(TOOL_PERMISSIONS).sort();
    expect(declared).toEqual([...TOOL_NAMES].sort());
  });

  it("marks destructive operations as destructive, not read/write", () => {
    expect(TOOL_PERMISSIONS.delete_page).toBe("destructive");
    expect(TOOL_PERMISSIONS.run_wp_cli).toBe("destructive");
    expect(TOOL_PERMISSIONS.get_project_state).toBe("read");
  });
});

describe("PROJECT_STATES", () => {
  it("starts at CREATED and includes every terminal state", () => {
    expect(PROJECT_STATES[0]).toBe("CREATED");
    expect(PROJECT_STATES).toContain("READY");
    expect(PROJECT_STATES).toContain("ERROR");
    expect(PROJECT_STATES).toContain("STOPPED");
  });
});
