import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * apps/agent/src/routes/content.ts (the Content tab): list pages, read one,
 * manual save, and the AI-draft-then-save flow. llm/client.js is mocked
 * ONLY in this file (see messages.test.ts for the same pattern) so the
 * ai-draft endpoint can be exercised deterministically without a real
 * provider; every other test in this file leaves `aiEnabled` false, matching
 * every other test file's default heuristic-only mode.
 */
let aiEnabled = false;
let aiDraftReply: string | null = '{"title": "AI-Rewritten Title", "content": "<p>AI-rewritten content.</p>"}';
vi.mock("@agent/llm/client.js", () => ({
  pickProvider: () => (aiEnabled ? "anthropic" : null),
  aiAvailable: () => aiEnabled,
  completeText: vi.fn(async () => aiDraftReply),
  completeVision: vi.fn().mockResolvedValue(null),
  streamAck: vi.fn().mockResolvedValue(undefined),
}));

import { authHeader, buildApp, buildProjectToReady, cleanupWorld, createProject, getProject, resetWorld } from "./helpers.js";

describe("content routes: reading pages", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    aiEnabled = false;
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("404s when the project doesn't exist", async () => {
    const res = await request(app).get("/projects/nope/pages").set(authHeader());
    expect(res.status).toBe(404);
  });

  it("409s when the environment isn't running yet", async () => {
    const project = await createProject(app); // still REQUIREMENTS, docker.status "none"
    const res = await request(app).get(`/projects/${project.id}/pages`).set(authHeader());
    expect(res.status).toBe(409);
  });

  it("GET /:id/pages lists the pages the build pipeline actually created, read live from (fake) WP-CLI", async () => {
    const ready = await buildProjectToReady(app);
    const res = await request(app).get(`/projects/${ready.id}/pages`).set(authHeader());
    expect(res.status).toBe(200);
    const slugs = res.body.map((p: { slug: string }) => p.slug).sort();
    expect(slugs).toEqual(["about", "contact", "home"]);
    expect(res.body[0]).toHaveProperty("id");
    expect(res.body[0]).toHaveProperty("status");
  }, 20_000);

  it("GET /:id/pages/:pageId returns full content for one page, 404s for an unknown pageId", async () => {
    const ready = await buildProjectToReady(app);
    const list = await request(app).get(`/projects/${ready.id}/pages`).set(authHeader());
    const home = list.body.find((p: { slug: string }) => p.slug === "home");
    expect(home).toBeDefined();

    const res = await request(app).get(`/projects/${ready.id}/pages/${home.id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("home");
    expect(typeof res.body.content).toBe("string");
    expect(res.body.content.length).toBeGreaterThan(0);

    const missing = await request(app).get(`/projects/${ready.id}/pages/999999`).set(authHeader());
    expect(missing.status).toBe(404);
  }, 20_000);
});

describe("content routes: manual save goes through checkpoint-then-dispatcher, like every other edit", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    aiEnabled = false;
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("PUT /:id/pages/:pageId checkpoints first, then dispatches update_page, and the change reads back through the API", async () => {
    const ready = await buildProjectToReady(app);
    const list = await request(app).get(`/projects/${ready.id}/pages`).set(authHeader());
    const about = list.body.find((p: { slug: string }) => p.slug === "about");

    const checkpointsBefore = ready.checkpoints.length;
    const auditBefore = ready.auditLog.length;

    const res = await request(app)
      .put(`/projects/${ready.id}/pages/${about.id}`)
      .set(authHeader())
      .send({ title: "About Us (Updated)", content: "<p>Manually edited copy.</p>" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("About Us (Updated)");
    expect(res.body.content).toBe("<p>Manually edited copy.</p>");

    const after = await getProject(app, ready.id);
    // VER-02: an auto checkpoint before the edit -- "always one Restore away
    // from undone", per routes/content.ts's own doc comment.
    expect(after.checkpoints.length).toBe(checkpointsBefore + 1);
    expect(after.checkpoints[after.checkpoints.length - 1].label).toMatch(/before: edit page "about"/);

    // SEC-03/05: the save itself went through tools/dispatcher.ts, not a
    // direct WP-CLI call -- audited like every other mutation.
    const newAuditEntries = after.auditLog.slice(auditBefore);
    expect(newAuditEntries).toHaveLength(1);
    expect(newAuditEntries[0]).toMatchObject({ tool: "update_page", ok: true, source: "manual", permission: "write" });

    // Read-back through the API's own GET, proving the save is real, not
    // just an echoed request body.
    const readBack = await request(app).get(`/projects/${ready.id}/pages/${about.id}`).set(authHeader());
    expect(readBack.body.title).toBe("About Us (Updated)");
    expect(readBack.body.content).toBe("<p>Manually edited copy.</p>");
  }, 20_000);

  it("400s when neither title nor content is provided, 404s for an unknown pageId", async () => {
    const ready = await buildProjectToReady(app);
    const empty = await request(app).put(`/projects/${ready.id}/pages/1`).set(authHeader()).send({});
    expect(empty.status).toBe(400);

    const missing = await request(app)
      .put(`/projects/${ready.id}/pages/999999`)
      .set(authHeader())
      .send({ title: "x" });
    expect(missing.status).toBe(404);
  }, 20_000);
});

describe("content routes: 'Ask AI to edit this page' draft-then-save flow", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    aiEnabled = false;
    aiDraftReply = '{"title": "AI-Rewritten Title", "content": "<p>AI-rewritten content.</p>"}';
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("503s when AI isn't configured", async () => {
    const ready = await buildProjectToReady(app);
    const list = await request(app).get(`/projects/${ready.id}/pages`).set(authHeader());
    const home = list.body.find((p: { slug: string }) => p.slug === "home");

    const res = await request(app)
      .post(`/projects/${ready.id}/pages/${home.id}/ai-draft`)
      .set(authHeader())
      .send({ instruction: "make it punchier" });
    expect(res.status).toBe(503);
  }, 20_000);

  it("400s with no instruction, 404s for an unknown page", async () => {
    const ready = await buildProjectToReady(app);
    const noInstruction = await request(app).post(`/projects/${ready.id}/pages/1/ai-draft`).set(authHeader()).send({});
    expect(noInstruction.status).toBe(400);

    const missingPage = await request(app)
      .post(`/projects/${ready.id}/pages/999999/ai-draft`)
      .set(authHeader())
      .send({ instruction: "x" });
    expect(missingPage.status).toBe(404);
  }, 20_000);

  it("drafts a suggestion WITHOUT touching WordPress, then saving it goes through the exact same checkpoint+dispatcher path a manual save does", async () => {
    const ready = await buildProjectToReady(app);
    const list = await request(app).get(`/projects/${ready.id}/pages`).set(authHeader());
    const home = list.body.find((p: { slug: string }) => p.slug === "home");
    const originalContent = (await request(app).get(`/projects/${ready.id}/pages/${home.id}`).set(authHeader())).body
      .content;

    aiEnabled = true;
    const checkpointsBefore = ready.checkpoints.length;
    const auditBefore = ready.auditLog.length;

    const draftRes = await request(app)
      .post(`/projects/${ready.id}/pages/${home.id}/ai-draft`)
      .set(authHeader())
      .send({ instruction: "make the homepage punchier" });
    expect(draftRes.status).toBe(200);
    expect(draftRes.body).toEqual({ title: "AI-Rewritten Title", content: "<p>AI-rewritten content.</p>" });

    // The draft step alone must not have touched checkpoints, the audit log,
    // or the live page -- it's only a suggestion until the user saves it.
    const afterDraft = await getProject(app, ready.id);
    expect(afterDraft.checkpoints.length).toBe(checkpointsBefore);
    expect(afterDraft.auditLog.length).toBe(auditBefore);
    const stillOriginal = await request(app).get(`/projects/${ready.id}/pages/${home.id}`).set(authHeader());
    expect(stillOriginal.body.content).toBe(originalContent);

    // Accepting the draft is just a normal PUT with the suggested
    // title/content -- same manual-save route, same checkpoint-then-
    // dispatcher path exercised in the describe block above.
    const saveRes = await request(app)
      .put(`/projects/${ready.id}/pages/${home.id}`)
      .set(authHeader())
      .send(draftRes.body);
    expect(saveRes.status).toBe(200);

    const afterSave = await getProject(app, ready.id);
    expect(afterSave.checkpoints.length).toBe(checkpointsBefore + 1);
    const newAuditEntries = afterSave.auditLog.slice(auditBefore);
    expect(newAuditEntries).toHaveLength(1);
    expect(newAuditEntries[0]).toMatchObject({ tool: "update_page", ok: true, source: "manual" });

    const readBack = await request(app).get(`/projects/${ready.id}/pages/${home.id}`).set(authHeader());
    expect(readBack.body.title).toBe("AI-Rewritten Title");
    expect(readBack.body.content).toBe("<p>AI-rewritten content.</p>");
  }, 20_000);

  it("a malformed AI reply is treated the same as AI being unavailable (503), not a crash", async () => {
    aiEnabled = true;
    aiDraftReply = "not valid json at all";
    const ready = await buildProjectToReady(app);
    const list = await request(app).get(`/projects/${ready.id}/pages`).set(authHeader());
    const home = list.body.find((p: { slug: string }) => p.slug === "home");

    const res = await request(app)
      .post(`/projects/${ready.id}/pages/${home.id}/ai-draft`)
      .set(authHeader())
      .send({ instruction: "x" });
    expect(res.status).toBe(503);
  }, 20_000);
});
