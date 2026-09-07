import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@ai-wp/shared";

/**
 * tools/checkpoint.ts (VER-02/VER-04): create-checkpoint / restore-checkpoint
 * must actually round-trip a real DB dump through the wpcli container, not
 * just shuffle in-memory state. `execWpCli`/`composeCp`/`projectDir` are
 * mocked at the `@agent/docker/compose.js` boundary per docs/TESTING.md;
 * `composeCp`'s mock actually writes a fake dump file to disk when copying
 * *out* of the container (mirroring what `docker compose cp` really does),
 * so the later `existsSync()` gate in `restoreCheckpoint` is exercised for
 * real instead of always short-circuiting to a no-op. `store.saveProject`
 * is mocked too (own module boundary, `@agent/db/store.js`) so this stays a
 * true unit test of checkpoint.ts, independent of the JSON-file/Postgres
 * persistence layer.
 */
let scratchRoot: string;

vi.mock("@agent/docker/compose.js", () => ({
  projectDir: vi.fn((projectId: string) => join(scratchRoot, "projects", projectId)),
  composeCp: vi.fn(async (_projectId: string, source: string, dest: string) => {
    // Real `docker compose cp` semantics: copying OUT of the container (a
    // "wpcli:..." source, a plain local path dest) actually produces a
    // file on disk. Copying IN (a "wpcli:..." dest) is a no-op here since
    // nothing local needs to exist afterward.
    if (!dest.startsWith("wpcli:")) {
      writeFileSync(dest, "-- fake sql dump --");
    }
    return { stdout: "", stderr: "" };
  }),
  execWpCli: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

vi.mock("@agent/db/store.js", () => ({
  store: { saveProject: vi.fn((p: Project) => p), getProject: vi.fn() },
}));

import { composeCp, execWpCli } from "@agent/docker/compose.js";
import { store } from "@agent/db/store.js";
import { createBackup, createCheckpoint, restoreBackup, restoreCheckpoint } from "@agent/tools/checkpoint.js";

const composeCpMock = vi.mocked(composeCp);
const execWpCliMock = vi.mocked(execWpCli);
const saveProjectMock = vi.mocked(store.saveProject);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Site",
    status: "READY",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    slots: {} as Project["slots"],
    spec: {
      site: { name: "Acme", type: "business", industry: "retail", audience: [] },
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

beforeEach(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), "aiwp-checkpoint-test-"));
  vi.clearAllMocks();
  saveProjectMock.mockImplementation((p: Project) => p);
});

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe("createCheckpoint", () => {
  it("dumps the live DB and records the dump file when the environment is running", async () => {
    const project = makeProject();
    const checkpoint = await createCheckpoint(project, "before edit", "manual");

    expect(checkpoint.dbDumpFile).not.toBeNull();
    expect(existsSync(checkpoint.dbDumpFile!)).toBe(true);
    expect(checkpoint.label).toBe("before edit");
    expect(checkpoint.kind).toBe("manual");
    expect(checkpoint.spec).toEqual(project.spec);
    expect(project.checkpoints).toContainEqual(checkpoint);
    expect(saveProjectMock).toHaveBeenCalledWith(project);

    // dumpDatabase's real command shape: export inside the container, copy
    // the file out, then clean up the remote temp file.
    const wpCalls = execWpCliMock.mock.calls.map((c) => c[1]);
    expect(wpCalls[0][0]).toBe("db");
    expect(wpCalls[0][1]).toBe("export");
    expect(composeCpMock).toHaveBeenCalledWith(
      "proj-1",
      expect.stringMatching(/^wpcli:\/tmp\/dump-/),
      checkpoint.dbDumpFile,
    );
    const cleanupCall = wpCalls.find((c) => c[0] === "eval");
    expect(cleanupCall?.[1]).toContain("unlink");
  });

  it("does not attempt a DB dump when the environment isn't running (spec snapshot still recorded)", async () => {
    const project = makeProject({ docker: { ...makeProject().docker, status: "stopped" } });
    const checkpoint = await createCheckpoint(project, "auto snapshot");

    expect(checkpoint.dbDumpFile).toBeNull();
    expect(checkpoint.spec).toEqual(project.spec);
    expect(execWpCliMock).not.toHaveBeenCalled();
    expect(composeCpMock).not.toHaveBeenCalled();
  });

  it("still records a spec-only checkpoint when the DB dump itself fails", async () => {
    execWpCliMock.mockRejectedValueOnce(new Error("db export failed"));
    const project = makeProject();
    const checkpoint = await createCheckpoint(project, "flaky dump");
    expect(checkpoint.dbDumpFile).toBeNull();
    expect(project.checkpoints).toHaveLength(1);
  });

  it("keeps at most MAX_AUTO_CHECKPOINTS=10 auto checkpoints, dropping the oldest first", async () => {
    const project = makeProject();
    for (let i = 0; i < 11; i++) {
      await createCheckpoint(project, `auto-${i}`, "auto");
    }
    const autos = project.checkpoints.filter((c) => c.kind === "auto");
    expect(autos).toHaveLength(10);
    expect(autos.map((c) => c.label)).not.toContain("auto-0");
    expect(autos.map((c) => c.label)).toContain("auto-10");
  });

  it("never trims manual checkpoints, even past the auto cap", async () => {
    const project = makeProject();
    await createCheckpoint(project, "manual-1", "manual");
    for (let i = 0; i < 11; i++) {
      await createCheckpoint(project, `auto-${i}`, "auto");
    }
    expect(project.checkpoints.filter((c) => c.kind === "manual")).toHaveLength(1);
    expect(project.checkpoints.filter((c) => c.kind === "auto")).toHaveLength(10);
  });
});

describe("restoreCheckpoint", () => {
  it("round-trips: restoring a checkpoint actually invokes the real DB-import path, not a no-op", async () => {
    const project = makeProject();
    const checkpoint = await createCheckpoint(project, "snapshot", "manual");

    // Mutate the live project's spec after the checkpoint, as an edit would.
    project.spec.site.name = "Mutated Name";
    execWpCliMock.mockClear();
    composeCpMock.mockClear();

    await restoreCheckpoint(project, checkpoint.id);

    expect(project.spec.site.name).toBe("Acme"); // restored from the checkpoint's snapshot
    expect(saveProjectMock).toHaveBeenCalledWith(project);

    // restoreDatabase's real command shape: copy the dump INTO the
    // container, then `wp db import` it, then clean up.
    expect(composeCpMock).toHaveBeenCalledWith(
      "proj-1",
      checkpoint.dbDumpFile,
      expect.stringMatching(/^wpcli:\/tmp\/restore-/),
    );
    const importCall = execWpCliMock.mock.calls.find((c) => c[1][0] === "db" && c[1][1] === "import");
    expect(importCall).toBeDefined();
  });

  it("throws for an unknown checkpoint id", async () => {
    const project = makeProject();
    await expect(restoreCheckpoint(project, "does-not-exist")).rejects.toThrow(/checkpoint not found/i);
  });

  it("restores the spec but skips the DB-import path when the checkpoint has no dump file (docker wasn't running at capture time)", async () => {
    const project = makeProject({ docker: { ...makeProject().docker, status: "stopped" } });
    const checkpoint = await createCheckpoint(project, "no-dump");
    expect(checkpoint.dbDumpFile).toBeNull();

    execWpCliMock.mockClear();
    await restoreCheckpoint(project, checkpoint.id);

    const importCall = execWpCliMock.mock.calls.find((c) => c[1][0] === "db" && c[1][1] === "import");
    expect(importCall).toBeUndefined();
  });

  it("skips the DB-import path when the environment is no longer running at restore time, even if a dump file exists", async () => {
    const project = makeProject();
    const checkpoint = await createCheckpoint(project, "snapshot");
    execWpCliMock.mockClear();

    project.docker.status = "stopped";
    await restoreCheckpoint(project, checkpoint.id);

    const importCall = execWpCliMock.mock.calls.find((c) => c[1][0] === "db" && c[1][1] === "import");
    expect(importCall).toBeUndefined();
    expect(project.spec.site.name).toBe("Acme"); // spec restore still happens
  });
});

describe("createBackup / restoreBackup", () => {
  it("createBackup dumps the DB and archives wp-content", async () => {
    const project = makeProject();
    const backup = await createBackup(project, "pre-launch");

    expect(existsSync(backup.dbDumpFile)).toBe(true);
    expect(project.backups).toContainEqual(backup);
    expect(saveProjectMock).toHaveBeenCalledWith(project);
    const evalCalls = execWpCliMock.mock.calls.filter((c) => c[1][0] === "eval").map((c) => c[1][1]);
    expect(evalCalls.some((snippet) => snippet.includes("tar czf"))).toBe(true);
  });

  it("createBackup throws when the environment isn't running", async () => {
    const project = makeProject({ docker: { ...makeProject().docker, status: "stopped" } });
    await expect(createBackup(project, "x")).rejects.toThrow(/must be running/i);
  });

  it("restoreBackup round-trips the DB import and the wp-content archive extraction", async () => {
    const project = makeProject();
    const backup = await createBackup(project, "pre-launch");
    execWpCliMock.mockClear();
    composeCpMock.mockClear();

    await restoreBackup(project, backup.id);

    const importCall = execWpCliMock.mock.calls.find((c) => c[1][0] === "db" && c[1][1] === "import");
    expect(importCall).toBeDefined();
    const extractCall = execWpCliMock.mock.calls
      .filter((c) => c[1][0] === "eval")
      .map((c) => c[1][1])
      .find((snippet) => snippet.includes("tar xzf"));
    expect(extractCall).toBeDefined();
  });

  it("restoreBackup throws for an unknown backup id", async () => {
    const project = makeProject();
    await expect(restoreBackup(project, "nope")).rejects.toThrow(/backup not found/i);
  });
});
