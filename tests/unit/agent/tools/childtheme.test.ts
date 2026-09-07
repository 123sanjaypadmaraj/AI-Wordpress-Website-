import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@ai-wp/shared";

/**
 * tools/childtheme.ts turns spec.design (GEN-10) into real CSS a browser
 * actually renders -- these tests assert on the *generated CSS text*
 * itself (real color/font/radius values appearing where expected), not
 * just "a string came back". Docker/WP-CLI calls are mocked per
 * docs/TESTING.md; `projectDir` is mocked to a throwaway temp directory so
 * `generateAndActivateChildTheme`'s real (unmocked) `node:fs` writes land
 * somewhere isolated instead of the real repo tree.
 */
let scratchRoot: string;

vi.mock("@agent/docker/compose.js", () => ({
  projectDir: vi.fn((projectId: string) => join(scratchRoot, "projects", projectId)),
  composeCp: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  execWpCli: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

import { composeCp, execWpCli } from "@agent/docker/compose.js";
import {
  childThemeSlug,
  childThemeStagingDir,
  generateAndActivateChildTheme,
  regenerateChildThemeStyles,
  renderChildThemeCss,
} from "@agent/tools/childtheme.js";

const composeCpMock = vi.mocked(composeCp);
const execWpCliMock = vi.mocked(execWpCli);

function makeProject(design: Partial<Project["spec"]["design"]> = {}, overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Site",
    status: "GENERATING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    slots: {} as Project["slots"],
    spec: {
      site: { name: "Acme Bakery", type: "business", industry: "food", audience: [] },
      pages: [],
      features: [],
      design: {
        style: "minimal",
        mode: "light",
        primary_color: "#3651D4",
        secondary_color: "#1E8E5A",
        heading_font: "Inter",
        body_font: "Georgia",
        radius: "soft",
        preset: "minimal",
        ...design,
      },
      theme: { selected: "astra", use_child_theme: true },
      ecommerce: { payment: null },
      seo: false,
      accessibility: false,
      integrations: [],
      discoveredSkills: [],
    },
    themeRecommendations: [],
    docker: {
      projectId: "proj-1",
      status: "running",
      wpPort: 8123,
      containerPrefix: "aiwp-proj-1",
      previewUrl: "http://localhost:8123",
      adminUrl: "http://localhost:8123/wp-admin",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    },
    log: [],
    auditLog: [],
    checkpoints: [],
    backups: [],
    ...overrides,
  } as Project;
}

beforeEach(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), "aiwp-childtheme-test-"));
  vi.clearAllMocks();
  composeCpMock.mockResolvedValue({ stdout: "", stderr: "" });
  execWpCliMock.mockResolvedValue({ stdout: "", stderr: "" });
});

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe("childThemeSlug / childThemeStagingDir", () => {
  it("builds the child theme slug from the parent slug", () => {
    expect(childThemeSlug("astra")).toBe("astra-ai-child");
  });

  it("scopes the staging dir under the project's own directory", () => {
    const dir = childThemeStagingDir("proj-1", "astra-ai-child");
    expect(dir).toBe(join(scratchRoot, "projects", "proj-1", "child-theme", "astra-ai-child"));
  });
});

describe("renderChildThemeCss", () => {
  it("embeds the exact primary/secondary colors from spec.design", () => {
    const css = renderChildThemeCss(
      makeProject({ primary_color: "#FF00AA", secondary_color: "#00CCEE" }),
      "astra",
      "Astra",
    );
    expect(css).toContain("--ai-primary: #FF00AA;");
    expect(css).toContain("--ai-secondary: #00CCEE;");
  });

  it("embeds the heading and body font stacks for a known Google Font pairing", () => {
    const css = renderChildThemeCss(
      makeProject({ heading_font: "Poppins", body_font: "IBM Plex Sans" }),
      "astra",
      "Astra",
    );
    expect(css).toContain("--ai-font-heading: 'Poppins', ui-sans-serif, system-ui, sans-serif;");
    expect(css).toContain("--ai-font-body: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;");
  });

  it("falls back to a generic sans-serif stack for a font outside the curated list", () => {
    const css = renderChildThemeCss(makeProject({ heading_font: "Some Random Font" }), "astra", "Astra");
    expect(css).toContain("--ai-font-heading: 'Some Random Font', ui-sans-serif, system-ui, sans-serif;");
  });

  it.each([
    ["sharp", "4px", "6px"],
    ["soft", "14px", "10px"],
    ["pill", "20px", "999px"],
  ] as const)("radius=%s maps to card=%s and button=%s (a pill card would look like a chip, so button goes further)", (radius, card, button) => {
    const css = renderChildThemeCss(makeProject({ radius }), "astra", "Astra");
    expect(css).toContain(`--ai-radius: ${card};`);
    expect(css).toContain(`--ai-radius-button: ${button};`);
  });

  it("switches background/text tokens for dark mode vs light mode", () => {
    const light = renderChildThemeCss(makeProject({ mode: "light" }), "astra", "Astra");
    expect(light).toContain("--ai-bg: #FFFFFF;");
    expect(light).toContain("--ai-text: #1B1D29;");

    const dark = renderChildThemeCss(makeProject({ mode: "dark" }), "astra", "Astra");
    expect(dark).toContain("--ai-bg: #14151C;");
    expect(dark).toContain("--ai-text: #E7E8F0;");
  });

  it("includes the site name and parent theme slug/name in the stylesheet header", () => {
    const css = renderChildThemeCss(makeProject(), "astra", "Astra");
    expect(css).toContain("Theme Name: Acme Bakery (AI Child)");
    expect(css).toContain("Template: astra");
    expect(css).toContain("of Astra");
  });
});

describe("generateAndActivateChildTheme", () => {
  it("writes real style.css + functions.php to the staging dir, ships them into the container, and activates the theme", async () => {
    const project = makeProject({ primary_color: "#123ABC" });
    const slug = await generateAndActivateChildTheme(project, "astra", "Astra");

    expect(slug).toBe("astra-ai-child");

    const dir = childThemeStagingDir(project.id, slug);
    expect(existsSync(join(dir, "style.css"))).toBe(true);
    expect(existsSync(join(dir, "functions.php"))).toBe(true);
    expect(readFileSync(join(dir, "style.css"), "utf-8")).toContain("--ai-primary: #123ABC;");
    expect(readFileSync(join(dir, "functions.php"), "utf-8")).toContain("wp_enqueue_style");

    expect(composeCpMock).toHaveBeenCalledWith("proj-1", dir, "wpcli:/var/www/html/wp-content/themes/astra-ai-child");
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["theme", "activate", "astra-ai-child"]);
  });

  it("clears any stale staging dir from a previous generation before writing", async () => {
    const project = makeProject();
    const dir = childThemeStagingDir(project.id, "astra-ai-child");
    // First generation with one color, second with a different one -- the
    // staging dir must not retain leftovers between runs.
    await generateAndActivateChildTheme(makeProject({ primary_color: "#111111" }), "astra", "Astra");
    await generateAndActivateChildTheme(makeProject({ primary_color: "#222222" }), "astra", "Astra");
    const css = readFileSync(join(dir, "style.css"), "utf-8");
    expect(css).toContain("--ai-primary: #222222;");
    expect(css).not.toContain("#111111");
  });
});

describe("regenerateChildThemeStyles", () => {
  it("re-renders only style.css (not functions.php) and re-activates the theme", async () => {
    const project = makeProject({ primary_color: "#ABCDEF" });
    const dir = childThemeStagingDir(project.id, "astra-ai-child");

    await regenerateChildThemeStyles(project, "astra", "Astra");

    expect(existsSync(join(dir, "functions.php"))).toBe(false); // never written by this path
    expect(readFileSync(join(dir, "style.css"), "utf-8")).toContain("--ai-primary: #ABCDEF;");
    expect(composeCpMock).toHaveBeenCalledWith(
      "proj-1",
      join(dir, "style.css"),
      "wpcli:/var/www/html/wp-content/themes/astra-ai-child/style.css",
    );
    expect(execWpCliMock).toHaveBeenCalledWith("proj-1", ["theme", "activate", "astra-ai-child"]);
  });
});
