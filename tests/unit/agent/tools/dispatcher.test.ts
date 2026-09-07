import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EMPTY_SLOTS, emptySiteSpecification, type Project } from "@ai-wp/shared";

/**
 * Security-focused unit tests for apps/agent/src/tools/dispatcher.ts --
 * SEC-03 (permission tiers), SEC-05 (audit log), SEC-06 (theme/plugin
 * allowlist), and TST-07 (bounded retry). See docs/TESTING.md's convention
 * once 01-test-harness lands (this file was written before it did -- see
 * coordination/status/04-unit-dispatcher-security.md).
 *
 * Mocking boundary: we mock the actual side-effecting layers
 * (tools/wordpress.ts, docker/compose.ts's execWpCli, tools/screenshot.ts,
 * db/store.ts) but deliberately do NOT mock tools/plugins.ts or
 * engine/themes.ts -- the whole point of the allowlist tests below is that
 * the *real* isAllowedTheme/isAllowedPlugin logic rejects an adversarial
 * slug, not a stubbed-out version of it. We also don't mock
 * engine/errors.ts's withRetry -- the retry-bound tests exercise the real
 * classify+backoff logic, just with fake timers so they run instantly.
 */

const wordpress = vi.hoisted(() => ({
  installTheme: vi.fn().mockResolvedValue(undefined),
  activateTheme: vi.fn().mockResolvedValue(undefined),
  installPlugin: vi.fn().mockResolvedValue(undefined),
  activatePlugin: vi.fn().mockResolvedValue(undefined),
  updateOption: vi.fn().mockResolvedValue(undefined),
  wpEval: vi.fn().mockResolvedValue(undefined),
  createPage: vi.fn().mockResolvedValue(1),
  updatePage: vi.fn().mockResolvedValue(undefined),
  deletePage: vi.fn().mockResolvedValue(undefined),
  getPageIdBySlug: vi.fn().mockResolvedValue(1),
  createMenu: vi.fn().mockResolvedValue(undefined),
  setHomepage: vi.fn().mockResolvedValue(undefined),
}));

const compose = vi.hoisted(() => ({
  execWpCli: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  composeCp: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  projectDir: vi.fn((id: string) => `/tmp/aiwp-test-projects/${id}`),
}));

const screenshot = vi.hoisted(() => ({
  captureScreenshot: vi.fn().mockResolvedValue({ path: "shot.png", url: "/shot.png" }),
}));

const storeMock = vi.hoisted(() => ({
  store: {
    saveProject: vi.fn((p: unknown) => p),
    getProject: vi.fn(),
    deleteProject: vi.fn(),
    listProjects: vi.fn(() => []),
    listMessages: vi.fn(() => []),
    appendMessage: vi.fn(),
  },
}));

vi.mock("../../../../apps/agent/src/tools/wordpress.js", () => wordpress);
vi.mock("../../../../apps/agent/src/docker/compose.js", () => compose);
vi.mock("../../../../apps/agent/src/tools/screenshot.js", () => screenshot);
vi.mock("../../../../apps/agent/src/db/store.js", () => storeMock);

const { callTool } = await import("../../../../apps/agent/src/tools/dispatcher.js");
const { THEME_CATALOG } = await import("../../../../apps/agent/src/engine/themes.js");
const { ALLOWED_PLUGINS } = await import("../../../../apps/agent/src/tools/plugins.js");

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return {
    id: "proj_test1",
    name: "Test Project",
    status: "READY",
    createdAt: now,
    updatedAt: now,
    slots: { ...EMPTY_SLOTS },
    spec: { ...emptySiteSpecification("Test Project"), pages: ["home", "about"] },
    themeRecommendations: [],
    docker: {
      projectId: "proj_test1",
      status: "running",
      wpPort: 8100,
      containerPrefix: "aiwp-proj_tes",
      previewUrl: "http://localhost:8100",
      adminUrl: "http://localhost:8100/wp-admin",
      createdAt: now,
      lastError: null,
    },
    log: [],
    auditLog: [],
    checkpoints: [],
    backups: [],
    ...overrides,
  };
}

// Reassign every mock's default implementation before each test rather than
// relying on the one-time defaults set when the hoisted objects above were
// built -- `vi.clearAllMocks()` (and this file's config's `clearMocks: true`)
// only clears call history, but we want each test to start from a known-good
// default regardless of what an earlier test's `mockResolvedValueOnce`/
// `mockImplementationOnce` left queued.
beforeEach(() => {
  vi.clearAllMocks();
  wordpress.installTheme.mockResolvedValue(undefined);
  wordpress.activateTheme.mockResolvedValue(undefined);
  wordpress.installPlugin.mockResolvedValue(undefined);
  wordpress.activatePlugin.mockResolvedValue(undefined);
  wordpress.updateOption.mockResolvedValue(undefined);
  wordpress.wpEval.mockResolvedValue(undefined);
  wordpress.createPage.mockResolvedValue(1);
  wordpress.updatePage.mockResolvedValue(undefined);
  wordpress.deletePage.mockResolvedValue(undefined);
  wordpress.getPageIdBySlug.mockResolvedValue(1);
  wordpress.createMenu.mockResolvedValue(undefined);
  wordpress.setHomepage.mockResolvedValue(undefined);
  compose.execWpCli.mockResolvedValue({ stdout: "", stderr: "" });
  compose.composeCp.mockResolvedValue({ stdout: "", stderr: "" });
  screenshot.captureScreenshot.mockResolvedValue({ path: "shot.png", url: "/shot.png" });
  storeMock.store.saveProject.mockImplementation((p: unknown) => p);
});

describe("dispatcher: permission tiers (SEC-03)", () => {
  it("rejects a destructive tool call with no confirmation, and does not execute it", async () => {
    const project = makeProject();
    await expect(
      callTool(project, "delete_page", { slug: "about" }, { source: "chat" }),
    ).rejects.toThrow(/destructive/i);
    expect(wordpress.deletePage).not.toHaveBeenCalled();
  });

  it("rejects a destructive call even when confirm is a truthy non-boolean (adversarial payload)", async () => {
    // A caller building `opts` from an untyped source (deserialized tool
    // call, raw request body) could pass confirm: "false" -- a non-empty
    // string, which is truthy in JS. The dispatcher must not treat that as
    // confirmation.
    const project = makeProject();
    await expect(
      callTool(
        project,
        "delete_page",
        { slug: "about" },
        { source: "chat", confirm: "false" as unknown as boolean },
      ),
    ).rejects.toThrow(/destructive/i);
    expect(wordpress.deletePage).not.toHaveBeenCalled();
  });

  it("allows a destructive tool call once confirm: true is set", async () => {
    const project = makeProject();
    const result = await callTool(
      project,
      "delete_page",
      { slug: "about" },
      { source: "chat", confirm: true },
    );
    expect(wordpress.deletePage).toHaveBeenCalledWith(project, 1);
    expect(result).toEqual({ id: 1 });
  });

  it("never requires confirmation for a read/write-tier tool", async () => {
    const project = makeProject();
    await expect(
      callTool(project, "create_page", { title: "New", slug: "new" }, { source: "chat" }),
    ).resolves.toEqual({ id: 1 });
  });

  it("run_wp_cli is destructive and is rejected without confirmation regardless of its args", async () => {
    const project = makeProject();
    await expect(
      callTool(project, "run_wp_cli", { args: ["option", "get", "siteurl"] }, { source: "manual" }),
    ).rejects.toThrow(/destructive/i);
    expect(compose.execWpCli).not.toHaveBeenCalled();
  });

  it("SECURITY FIX regression: a rejected destructive call is still audited (was previously silently dropped)", async () => {
    // Before the fix, the confirm gate threw *before* the dispatcher's
    // try/finally, so a rejected destructive call left zero trace in
    // project.auditLog -- exactly the kind of call an audit trail most
    // needs to capture. This proves the rejection now produces an entry.
    const project = makeProject();
    expect(project.auditLog).toHaveLength(0);
    await expect(
      callTool(project, "delete_page", { slug: "about" }, { source: "chat" }),
    ).rejects.toThrow();
    expect(project.auditLog).toHaveLength(1);
    expect(project.auditLog[0]).toMatchObject({
      tool: "delete_page",
      permission: "destructive",
      ok: false,
      source: "chat",
    });
    expect(project.auditLog[0].error).toMatch(/confirmation/i);
  });
});

describe("dispatcher: theme/plugin allowlist enforcement (SEC-06)", () => {
  it("rejects an unknown theme slug passed directly to the dispatcher (adversarial payload, not via the UI)", async () => {
    const project = makeProject();
    await expect(
      callTool(project, "install_theme", { slug: "../../evil-theme; rm -rf /" }, { source: "chat", confirm: true }),
    ).rejects.toThrow(/not in the trusted theme allowlist/i);
    expect(wordpress.installTheme).not.toHaveBeenCalled();
  });

  it("rejects an unknown theme slug for activate_theme too", async () => {
    const project = makeProject();
    await expect(
      callTool(project, "activate_theme", { slug: "totally-made-up-theme" }, { source: "chat" }),
    ).rejects.toThrow(/not in the trusted theme allowlist/i);
    expect(wordpress.activateTheme).not.toHaveBeenCalled();
  });

  it("allows a real catalog theme slug through install_theme/activate_theme", async () => {
    const project = makeProject();
    const slug = THEME_CATALOG[0].slug;
    await expect(
      callTool(project, "install_theme", { slug }, { source: "pipeline" }),
    ).resolves.toBeUndefined(); // installTheme's own return value, not a rejection
    expect(wordpress.installTheme).toHaveBeenCalledWith(project, slug);
  });

  it("rejects an unknown/adversarial plugin slug passed directly to the dispatcher for install_plugin", async () => {
    const project = makeProject();
    await expect(
      callTool(project, "install_plugin", { slug: "evil-backdoor-plugin" }, { source: "chat", confirm: true }),
    ).rejects.toThrow(/not in the trusted plugin allowlist/i);
    expect(wordpress.installPlugin).not.toHaveBeenCalled();
  });

  it("rejects an unknown/adversarial plugin slug for activate_plugin too", async () => {
    const project = makeProject();
    await expect(
      callTool(project, "activate_plugin", { slug: "../../../etc/passwd" }, { source: "chat" }),
    ).rejects.toThrow(/not in the trusted plugin allowlist/i);
    expect(wordpress.activatePlugin).not.toHaveBeenCalled();
  });

  it("allows a real allowlisted plugin slug through install_plugin (real isAllowedPlugin + installAndConfigurePlugin path)", async () => {
    const project = makeProject();
    const slug = ALLOWED_PLUGINS[0].slug;
    await expect(
      callTool(project, "install_plugin", { slug }, { source: "pipeline" }),
    ).resolves.toBeUndefined();
    expect(wordpress.installPlugin).toHaveBeenCalledWith(project, slug);
  });
});

describe("dispatcher: audit log shape + distinguishability (SEC-05)", () => {
  it("records a complete, well-shaped entry for a successful call", async () => {
    const project = makeProject();
    await callTool(project, "create_page", { title: "New", slug: "new" }, { source: "chat" });
    expect(project.auditLog).toHaveLength(1);
    const entry = project.auditLog[0];
    expect(entry).toMatchObject({
      projectId: "proj_test1",
      tool: "create_page",
      permission: "write",
      ok: true,
      error: null,
      source: "chat",
    });
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.timestamp).toBe("string");
    expect(typeof entry.durationMs).toBe("number");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records ok:false with a non-null error string for a rejected/failed call, distinguishable from success", async () => {
    const project = makeProject();
    // Persistent (not "Once"): classifyError has no fatal/transient pattern
    // for "no existing page with slug", so it defaults to "transient" and
    // withRetry will retry once by default (see the Decisions log in
    // coordination/status/04-unit-dispatcher-security.md) -- retries: 0
    // keeps this assertion about audit-log shape, not retry timing.
    wordpress.getPageIdBySlug.mockResolvedValue(null);
    await expect(
      callTool(project, "update_page", { slug: "missing", title: "x" }, { source: "chat", retries: 0 }),
    ).rejects.toThrow();
    const entry = project.auditLog[0];
    expect(entry.ok).toBe(false);
    expect(entry.error).toEqual(expect.any(String));
    expect(entry.error).not.toBeNull();
  });

  it("redacts args that look like secrets before they reach the audit log", async () => {
    const project = makeProject();
    await callTool(
      project,
      "create_page",
      { title: "New", slug: "new", apiKey: "sk-live-should-not-leak", password: "hunter2" },
      { source: "chat" },
    );
    const entry = project.auditLog[0];
    expect(entry.args.apiKey).toBe("[redacted]");
    expect(entry.args.password).toBe("[redacted]");
    expect(entry.args.slug).toBe("new"); // non-secret-shaped fields pass through
  });

  it("caps the audit log at 300 entries, dropping the oldest first", async () => {
    const project = makeProject();
    project.auditLog = Array.from({ length: 300 }, (_, i) => ({
      id: `old-${i}`,
      projectId: project.id,
      timestamp: new Date(0).toISOString(),
      tool: "get_project_state" as const,
      permission: "read" as const,
      args: {},
      ok: true,
      error: null,
      durationMs: 0,
      source: "manual" as const,
    }));
    await callTool(project, "create_page", { title: "New", slug: "new" }, { source: "chat" });
    expect(project.auditLog).toHaveLength(300);
    expect(project.auditLog[0].id).toBe("old-1"); // oldest ("old-0") was dropped
    expect(project.auditLog[299].tool).toBe("create_page");
  });

  it("persists the project (store.saveProject) after every dispatched call, success or rejection", async () => {
    const project = makeProject();
    await callTool(project, "create_page", { title: "New", slug: "new" }, { source: "chat" });
    await expect(
      callTool(project, "delete_page", { slug: "about" }, { source: "chat" }),
    ).rejects.toThrow();
    expect(storeMock.store.saveProject).toHaveBeenCalledTimes(2);
  });
});

describe("dispatcher: bounded retry for transient Docker/WP-CLI failures (TST-07)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers(); // don't leak fake timers into later describe blocks
  });

  it("retries a transient failure up to the bound, then succeeds", async () => {
    compose.execWpCli
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("container wpcli is unhealthy"))
      .mockResolvedValueOnce({ stdout: "ok", stderr: "" });

    const project = makeProject();
    const promise = callTool(
      project,
      "run_wp_cli",
      { args: ["cache", "flush"] },
      { source: "manual", confirm: true, retries: 2 },
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ stdout: "ok" });
    expect(compose.execWpCli).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(project.auditLog[0]).toMatchObject({ ok: true, error: null });
  });

  it("does NOT retry forever -- gives up after the configured bound and surfaces the final error", async () => {
    compose.execWpCli.mockRejectedValue(new Error("ETIMEDOUT"));

    const project = makeProject();
    const promise = callTool(
      project,
      "run_wp_cli",
      { args: ["cache", "flush"] },
      { source: "manual", confirm: true, retries: 2 },
    );
    promise.catch(() => {}); // avoid an unhandled-rejection window while timers advance below
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow(/ETIMEDOUT/);
    expect(compose.execWpCli).toHaveBeenCalledTimes(3); // 1 initial + 2 retries, then give up
    expect(project.auditLog[0]).toMatchObject({ ok: false });
    expect(project.auditLog[0].error).toMatch(/ETIMEDOUT/);
  });

  it("does not retry a fatal (non-transient) error even once", async () => {
    compose.execWpCli.mockRejectedValue(new Error("Cannot connect to the Docker daemon"));

    const project = makeProject();
    const promise = callTool(
      project,
      "run_wp_cli",
      { args: ["cache", "flush"] },
      { source: "manual", confirm: true, retries: 2 },
    );
    promise.catch(() => {}); // avoid an unhandled-rejection window while timers advance below
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow(/Docker daemon/);
    expect(compose.execWpCli).toHaveBeenCalledTimes(1); // fatal -- no retry at all
  });

  it("defaults to a bounded retry (1) when the caller doesn't specify one", async () => {
    compose.execWpCli.mockRejectedValue(new Error("ECONNRESET"));

    const project = makeProject();
    const promise = callTool(
      project,
      "run_wp_cli",
      { args: ["cache", "flush"] },
      { source: "manual", confirm: true }, // no retries specified
    );
    promise.catch(() => {}); // avoid an unhandled-rejection window while timers advance below
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow();
    expect(compose.execWpCli).toHaveBeenCalledTimes(2); // 1 initial + default 1 retry
  });
});

describe("dispatcher: destructive operations go through the same audited/confirmed path", () => {
  it("delete_page (destructive) cannot bypass confirmation or the audit log", async () => {
    const project = makeProject();
    await expect(
      callTool(project, "delete_page", { slug: "about" }, { source: "chat" }),
    ).rejects.toThrow(/destructive/i);
    expect(project.auditLog).toHaveLength(1);
    expect(project.auditLog[0].ok).toBe(false);

    await callTool(project, "delete_page", { slug: "about" }, { source: "chat", confirm: true });
    expect(project.auditLog).toHaveLength(2);
    expect(project.auditLog[1].ok).toBe(true);
    expect(wordpress.createMenu).toHaveBeenCalled(); // delete_page also re-syncs the nav menu
  });

  it("run_wp_cli (destructive) restricts subcommands even once confirmed", async () => {
    const project = makeProject();
    // retries: 0 -- "restricted to" isn't a fatal/transient pattern in
    // classifyError so it would otherwise default to one wasted retry
    // (see Decisions log); irrelevant to what this test asserts.
    await expect(
      callTool(
        project,
        "run_wp_cli",
        { args: ["db", "reset", "--yes"] },
        { source: "manual", confirm: true, retries: 0 },
      ),
    ).rejects.toThrow(/restricted to/i);
    expect(compose.execWpCli).not.toHaveBeenCalled();
    expect(project.auditLog[0].ok).toBe(false);
  });

  // --- KNOWN GAP, NOT FIXED IN THIS FILE ------------------------------------
  // dispatcher.ts is the *only* documented chokepoint for WordPress-affecting
  // operations, but project delete (routes/projects.ts DELETE /:id) and DB
  // restore/undo (tools/checkpoint.ts restoreCheckpoint/restoreBackup, called
  // directly from routes/projects.ts) never go through callTool at all --
  // they call store.deleteProject / restoreCheckpoint / restoreBackup
  // directly. That means these operations get NO confirmation gate and NO
  // audit-log entry, even though they are at least as destructive as
  // delete_page/run_wp_cli. Fixing this properly means adding ToolName
  // entries + dispatcher cases and rewiring routes/projects.ts, which
  // touches packages/shared and routes/projects.ts -- outside this task's
  // file ownership (see coordination/status/04-unit-dispatcher-security.md's
  // "SECURITY FIX" section for the full writeup). The two tests below are
  // marked `.fails()` on purpose: they assert the DESIRED, audited behavior,
  // so they show as an expected failure now and will start failing the
  // suite (prompting a fix) the moment someone's change makes them pass.
  it.fails(
    "KNOWN GAP (P0): restoreCheckpoint should append an audit-log entry but currently doesn't",
    async () => {
      const { restoreCheckpoint } = await import("../../../../apps/agent/src/tools/checkpoint.js");
      const project = makeProject({
        checkpoints: [
          {
            id: "cp1",
            projectId: "proj_test1",
            createdAt: new Date().toISOString(),
            label: "before edit",
            kind: "auto",
            spec: emptySiteSpecification("Test Project"),
            dbDumpFile: null,
          },
        ],
      });
      await restoreCheckpoint(project, "cp1");
      expect(project.auditLog).toHaveLength(1); // currently stays 0 -- ungated, unaudited
    },
  );

  it.fails(
    "KNOWN GAP (P0): restoreBackup should append an audit-log entry but currently doesn't",
    async () => {
      const { restoreBackup } = await import("../../../../apps/agent/src/tools/checkpoint.js");
      const project = makeProject({
        backups: [
          {
            id: "bk1",
            projectId: "proj_test1",
            createdAt: new Date().toISOString(),
            label: "manual backup",
            dbDumpFile: "/tmp/aiwp-test-projects/proj_test1/backups/bk1.sql",
            filesArchive: null,
          },
        ],
      });
      await restoreBackup(project, "bk1");
      expect(project.auditLog).toHaveLength(1); // currently stays 0 -- ungated, unaudited
    },
  );
});
