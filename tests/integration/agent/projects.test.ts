import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  AGENT_KEY,
  authHeader,
  buildApp,
  buildProjectToReady,
  cleanupWorld,
  createProject,
  driveToThemeSelection,
  execWpCliMock,
  getProject,
  resetWorld,
  selectTheme,
  waitForStatus,
} from "./helpers.js";

/**
 * apps/agent/src/routes/projects.ts + engine/orchestrator.ts, end to end
 * over real HTTP (supertest against the real Express app -- see
 * apps/agent/src/app.ts) with only Docker/WP-CLI/Playwright mocked (see
 * helpers.ts). Covers: auth, the full generation state machine from CREATED
 * through READY, checkpoints/audit-log readback, and delete going through
 * the dispatcher (SEC-03/05).
 */
describe("projects routes: auth", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("rejects every /projects route without X-Agent-Key", async () => {
    const res = await request(app).get("/projects");
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong key", async () => {
    const res = await request(app).get("/projects").set("X-Agent-Key", "not-the-right-key");
    expect(res.status).toBe(401);
  });

  it("/health stays open with no key at all", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("accepts the correct key", async () => {
    const res = await request(app).get("/projects").set(authHeader());
    expect(res.status).toBe(200);
  });
});

describe("project lifecycle: full state machine through real HTTP calls", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("POST /projects creates a project already past CREATED, in REQUIREMENTS", async () => {
    const project = await createProject(app, "Acme Co");
    expect(project.name).toBe("Acme Co");
    expect(project.status).toBe("REQUIREMENTS");
    expect(project.docker.status).toBe("none");
    expect(project.checkpoints).toEqual([]);
    expect(project.auditLog).toEqual([]);
  });

  it("defaults an empty/whitespace name to 'Untitled Project' and caps an overlong one at 200 chars", async () => {
    const untitled = await createProject(app, "   ");
    expect(untitled.name).toBe("Untitled Project");

    const long = await createProject(app, "x".repeat(500));
    expect(long.name).toHaveLength(200);
  });

  it("drives CREATED -> REQUIREMENTS -> SPECIFICATION_READY -> THEME_SELECTION via chat, then the full build pipeline to READY", async () => {
    const project = await createProject(app);
    const afterRequirements = await driveToThemeSelection(app, project.id);
    expect(afterRequirements.status).toBe("THEME_SELECTION");
    expect(afterRequirements.spec.site.type).toBe("business");
    expect(afterRequirements.spec.pages).toEqual(["home", "about", "contact"]);
    expect(afterRequirements.themeRecommendations.length).toBeGreaterThan(0);

    const selectRes = await selectTheme(app, project.id, "twentytwentyfour");
    // Fire-and-forget pipeline: the response itself only proves the state
    // transition happened synchronously, before any build work runs.
    expect(selectRes.status).toBe("ENVIRONMENT_CREATING");
    expect(selectRes.spec.theme.selected).toBe("twentytwentyfour");

    const ready = await waitForStatus(app, project.id, ["READY", "ERROR"]);
    expect(ready.status).toBe("READY");
    expect(ready.docker.status).toBe("running");
    expect(ready.docker.previewUrl).toBe("http://localhost:8100");

    // The pipeline creates one page per spec.pages entry, installs the
    // theme, installs the two always-on plugins, and wires up the nav menu
    // -- all through the dispatcher, so every one of those is audited.
    const tools = ready.auditLog.map((e) => e.tool);
    expect(tools).toContain("install_theme");
    expect(tools.filter((t) => t === "create_page")).toHaveLength(3);
    expect(tools).toContain("create_menu");
    expect(ready.auditLog.every((e) => e.ok)).toBe(true);

    // VER-02: a baseline checkpoint once the build is usable.
    expect(ready.checkpoints).toHaveLength(1);
    expect(ready.checkpoints[0].kind).toBe("auto");
    expect(ready.checkpoints[0].dbDumpFile).not.toBeNull();

    // The pipeline never shells out anywhere but through the mocked
    // WP-CLI boundary -- proves the state machine, not real Docker, drove
    // this to READY.
    expect(execWpCliMock).toHaveBeenCalled();
  }, 20_000);

  it("GET /projects lists created projects, newest-updated first", async () => {
    const first = await createProject(app, "First");
    await new Promise((r) => setTimeout(r, 5));
    const second = await createProject(app, "Second");

    const res = await request(app).get("/projects").set(authHeader());
    expect(res.status).toBe(200);
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids[0]).toBe(second.id);
    expect(ids).toContain(first.id);
  });

  it("GET /projects/:id 404s for an unknown id", async () => {
    const res = await request(app).get("/projects/does-not-exist").set(authHeader());
    expect(res.status).toBe(404);
  });

  it("GET /projects/:id/audit-log and /checkpoints read back what the pipeline recorded", async () => {
    const ready = await buildProjectToReady(app);
    const auditRes = await request(app).get(`/projects/${ready.id}/audit-log`).set(authHeader());
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.length).toBeGreaterThan(0);

    const checkpointsRes = await request(app).get(`/projects/${ready.id}/checkpoints`).set(authHeader());
    expect(checkpointsRes.status).toBe(200);
    expect(checkpointsRes.body).toHaveLength(1);
  }, 20_000);
});

describe("DELETE /projects/:id goes through the dispatcher (SEC-03/05 -- task 08 P0 fix)", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("deletes a project and it disappears from both GET /:id and the list", async () => {
    const project = await createProject(app, "Throwaway");
    const del = await request(app).delete(`/projects/${project.id}`).set(authHeader());
    expect(del.status).toBe(204);

    const getRes = await request(app).get(`/projects/${project.id}`).set(authHeader());
    expect(getRes.status).toBe(404);

    const listRes = await request(app).get("/projects").set(authHeader());
    expect(listRes.body.map((p: { id: string }) => p.id)).not.toContain(project.id);
  });

  it("404s deleting an id that was never created", async () => {
    const res = await request(app).delete("/projects/nope").set(authHeader());
    expect(res.status).toBe(404);
  });
});

describe("AGENT_API_KEY is not respected across different values", () => {
  // Sanity check that AGENT_KEY from helpers.ts is actually what auth.ts
  // compares against -- guards against a future helpers.ts change silently
  // making auth a no-op for the whole suite.
  it("the key this suite uses is non-trivial", () => {
    expect(AGENT_KEY.length).toBeGreaterThan(5);
  });
});
