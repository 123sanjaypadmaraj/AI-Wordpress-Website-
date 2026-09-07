import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@ai-wp/shared";

/**
 * tools/export.ts (EXP-01/EXP-02): the exported bundle must contain WXR
 * content + the generated child theme + a deploy/docker-compose.yml -- and,
 * per the README's "credential-free" claim, must NEVER contain a real
 * secret. `exportProject` doesn't expose its staging directory, but it also
 * never deletes it after zipping, so these tests read the *actual* files it
 * wrote (the same bytes that went into the zip) directly off disk -- a
 * stronger check than inspecting the compressed zip, and exactly the
 * "assert on the actual generated file contents" approach docs/TESTING.md
 * recommends for this file.
 *
 * `@agent/docker/compose.js` is mocked per docs/TESTING.md; `projectDir` and
 * `readProjectSecret` route into a throwaway temp directory / fixture
 * secrets so this project's real (unmocked) `node:fs` calls stay isolated.
 */
let scratchRoot: string;

const FAKE_SECRETS: Record<string, string> = {
  DB_PASSWORD: "sup3r-s3cret-db-pw",
  DB_ROOT_PASSWORD: "sup3r-s3cret-root-pw",
  WP_ADMIN_PASSWORD: "sup3r-s3cret-admin-pw",
};

vi.mock("@agent/docker/compose.js", () => ({
  projectDir: vi.fn((projectId: string) => join(scratchRoot, "projects", projectId)),
  composeCp: vi.fn(async (_projectId: string, source: string, dest: string) => {
    if (!dest.startsWith("wpcli:") && source.startsWith("wpcli:")) {
      // Simulates `wp export`'s output landing on disk after the copy-out.
      writeFileSync(dest, "<?xml version=\"1.0\"?><rss><channel><!-- WXR export --></channel></rss>");
    }
    return { stdout: "", stderr: "" };
  }),
  execWpCli: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  readProjectSecret: vi.fn((_projectId: string, key: string) => FAKE_SECRETS[key] ?? null),
}));

import { composeCp, execWpCli } from "@agent/docker/compose.js";
import { childThemeSlug, childThemeStagingDir } from "@agent/tools/childtheme.js";
import { exportProject, exportsListDir } from "@agent/tools/export.js";

const composeCpMock = vi.mocked(composeCp);
const execWpCliMock = vi.mocked(execWpCli);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Site",
    status: "READY",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    slots: {} as Project["slots"],
    spec: {
      site: { name: "Acme Bakery", type: "business", industry: "food", audience: [] },
      pages: ["home"],
      features: [],
      design: {
        style: "minimal",
        mode: "light",
        primary_color: "#3651D4",
        secondary_color: "#1E8E5A",
        heading_font: "Inter",
        body_font: "Inter",
        radius: "soft",
        preset: "minimal",
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

/** Renders a fixture docker-compose.yml exactly the way `renderCompose` in
 * `docker/compose.ts` does today -- real secret values baked directly into
 * the environment block -- so this test exercises `export.ts`'s own
 * redaction rather than relying on the template being credential-free. */
function writeFixtureComposeFile(projectId: string) {
  const dir = join(scratchRoot, "projects", projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "docker-compose.yml"),
    [
      "services:",
      "  wordpress:",
      "    environment:",
      `      WORDPRESS_DB_PASSWORD: ${FAKE_SECRETS.DB_PASSWORD}`,
      "  db:",
      "    environment:",
      `      MARIADB_ROOT_PASSWORD: ${FAKE_SECRETS.DB_ROOT_PASSWORD}`,
      `      MARIADB_PASSWORD: ${FAKE_SECRETS.DB_PASSWORD}`,
      "",
    ].join("\n"),
  );
}

function writeFixtureChildTheme(projectId: string, parentSlug: string) {
  const slug = childThemeSlug(parentSlug);
  const dir = childThemeStagingDir(projectId, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "style.css"), ":root { --ai-primary: #3651D4; }");
  writeFileSync(join(dir, "functions.php"), "<?php // child theme functions\n");
  return slug;
}

/** Finds the one `staging-*` dir exportProject leaves behind (it never
 * cleans it up), so tests can inspect the exact bytes that went into the
 * zip. */
function findStagingDir(projectId: string): string {
  const dir = exportsListDir(projectId);
  const entry = readdirSync(dir).find((f) => f.startsWith("staging-"));
  if (!entry) throw new Error("no staging dir produced by exportProject");
  return join(dir, entry);
}

/** Manual recursive walk instead of `readdirSync(..., { recursive: true })`
 * -- `Dirent.path`/`.parentPath` behavior for the nested-entry case varies
 * across Node versions, so this is written to not depend on it. */
function readAllFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [path, content] of readAllFiles(full)) files.set(path, content);
    } else if (entry.isFile()) {
      files.set(full, readFileSync(full, "utf-8"));
    }
  }
  return files;
}

beforeEach(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), "aiwp-export-test-"));
  vi.clearAllMocks();
  composeCpMock.mockImplementation(async (_projectId: string, source: string, dest: string) => {
    if (!dest.startsWith("wpcli:") && source.startsWith("wpcli:")) {
      writeFileSync(dest, "<?xml version=\"1.0\"?><rss><channel><!-- WXR export --></channel></rss>");
    }
    return { stdout: "", stderr: "" };
  });
  execWpCliMock.mockResolvedValue({ stdout: "", stderr: "" });
});

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe("exportProject", () => {
  it("throws when the environment isn't running, and touches nothing on disk", async () => {
    const project = makeProject({ docker: { ...makeProject().docker, status: "stopped" } });
    // Compute the exports path directly rather than via exportsListDir(),
    // which itself mkdir's the directory as a side effect of looking it up.
    const wouldBeExportsDir = join(scratchRoot, "projects", project.id, "exports");
    await expect(exportProject(project)).rejects.toThrow(/must be running/i);
    expect(existsSync(wouldBeExportsDir)).toBe(false);
  });

  it("calls WP-CLI's exporter with the expected flags", async () => {
    const project = makeProject();
    writeFixtureComposeFile(project.id);
    await exportProject(project);
    const exportCall = execWpCliMock.mock.calls.find((c) => c[1][0] === "export");
    expect(exportCall).toBeDefined();
    expect(exportCall![1]).toEqual(
      expect.arrayContaining(["export", "--dir=/tmp", expect.stringMatching(/^--filename_format=export-/)]),
    );
  });

  it("bundles WXR content, the generated child theme, and a docker-compose.yml", async () => {
    const project = makeProject();
    writeFixtureComposeFile(project.id);
    const slug = writeFixtureChildTheme(project.id, "astra");

    const result = await exportProject(project);
    expect(result.bytes).toBeGreaterThan(0);
    expect(existsSync(result.file)).toBe(true);

    const workDir = findStagingDir(project.id);
    expect(readFileSync(join(workDir, "content.xml"), "utf-8")).toContain("WXR export");
    expect(readFileSync(join(workDir, "child-theme", slug, "style.css"), "utf-8")).toContain("--ai-primary: #3651D4");
    expect(existsSync(join(workDir, "child-theme", slug, "functions.php"))).toBe(true);
    expect(existsSync(join(workDir, "deploy", "docker-compose.yml"))).toBe(true);
    expect(readFileSync(join(workDir, "README.md"), "utf-8")).toContain("Acme Bakery");
  });

  it("falls back to a placeholder content.xml when the WP-CLI export file can't be located, without failing the whole export", async () => {
    composeCpMock.mockImplementation(async (_id, source: string, dest: string) => {
      if (source.startsWith("wpcli:")) throw new Error("file not found in container");
      return { stdout: "", stderr: "" };
    });
    const project = makeProject();
    writeFixtureComposeFile(project.id);
    const result = await exportProject(project);
    expect(result.bytes).toBeGreaterThan(0);
    const workDir = findStagingDir(project.id);
    expect(readFileSync(join(workDir, "content.xml"), "utf-8")).toContain("export unavailable");
  });

  it("skips the child-theme folder entirely when no child theme was ever generated for this project", async () => {
    const project = makeProject();
    writeFixtureComposeFile(project.id);
    await exportProject(project);
    const workDir = findStagingDir(project.id);
    expect(existsSync(join(workDir, "child-theme"))).toBe(false);
  });

  it("skips the deploy/ folder when no docker-compose.yml exists for the project yet", async () => {
    const project = makeProject();
    // Deliberately do NOT call writeFixtureComposeFile.
    await exportProject(project);
    const workDir = findStagingDir(project.id);
    expect(existsSync(join(workDir, "deploy"))).toBe(false);
  });

  describe("credential-free export (README claim, hard security check)", () => {
    it("never lets the real DB password / DB root password / admin password reach any file in the bundle", async () => {
      const project = makeProject();
      writeFixtureComposeFile(project.id); // contains the real secrets, like the live renderer produces
      writeFixtureChildTheme(project.id, "astra");

      await exportProject(project);
      const workDir = findStagingDir(project.id);
      const files = readAllFiles(workDir);

      expect(files.size).toBeGreaterThan(0);
      for (const [path, content] of files) {
        for (const [key, secret] of Object.entries(FAKE_SECRETS)) {
          expect(content, `${path} must not contain the real ${key} value`).not.toContain(secret);
        }
      }
    });

    it("redacts the compose file's secrets to placeholders rather than just deleting the lines (still a usable compose file)", async () => {
      const project = makeProject();
      writeFixtureComposeFile(project.id);
      await exportProject(project);
      const workDir = findStagingDir(project.id);
      const compose = readFileSync(join(workDir, "deploy", "docker-compose.yml"), "utf-8");
      expect(compose).not.toContain(FAKE_SECRETS.DB_PASSWORD);
      expect(compose).not.toContain(FAKE_SECRETS.DB_ROOT_PASSWORD);
      expect(compose).toContain("${DB_PASSWORD}");
      expect(compose).toContain("${DB_ROOT_PASSWORD}");
      // The rest of the file (service/service structure) is untouched.
      expect(compose).toContain("WORDPRESS_DB_PASSWORD:");
      expect(compose).toContain("MARIADB_ROOT_PASSWORD:");
    });

    it("the .env file itself (where the real secrets actually live) is never read into the bundle at all", async () => {
      const project = makeProject();
      writeFixtureComposeFile(project.id);
      writeFileSync(
        join(scratchRoot, "projects", project.id, ".env"),
        `DB_PASSWORD=${FAKE_SECRETS.DB_PASSWORD}\n`,
      );
      await exportProject(project);
      const workDir = findStagingDir(project.id);
      expect(existsSync(join(workDir, ".env"))).toBe(false);
      for (const [, content] of readAllFiles(workDir)) {
        expect(content).not.toContain(FAKE_SECRETS.DB_PASSWORD);
      }
    });
  });
});

describe("exportsListDir", () => {
  it("returns the same directory exportProject stages/zips into", async () => {
    const project = makeProject();
    writeFixtureComposeFile(project.id);
    const result = await exportProject(project);
    expect(result.file.startsWith(exportsListDir(project.id))).toBe(true);
  });
});
