import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  authHeader,
  buildApp,
  cleanupWorld,
  createProject,
  driveToThemeSelection,
  getProject,
  resetWorld,
  waitForStatus,
} from "./helpers.js";

/**
 * apps/agent/src/routes/themes.ts. THEME_SOURCE=catalog (set in helpers.ts)
 * keeps recommendThemes() offline -- only the curated THEME_CATALOG is ever
 * returned, no live themes.wordpress.org search.
 */
describe("themes routes", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("GET /projects/catalog returns the curated, offline theme catalog", async () => {
    const res = await request(app).get("/projects/catalog").set(authHeader());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.map((t: { slug: string }) => t.slug)).toContain("twentytwentyfour");
  });

  it("GET /:id/themes 404s for an unknown project, 200s with recommendations for a real one", async () => {
    const missing = await request(app).get("/projects/nope/themes").set(authHeader());
    expect(missing.status).toBe(404);

    const project = await createProject(app);
    const res = await request(app).get(`/projects/${project.id}/themes`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("score");
    expect(res.body[0]).toHaveProperty("variants");
  });

  it("POST /:id/themes/select rejects an unknown/adversarial theme slug (SEC-06)", async () => {
    const project = await createProject(app);
    const res = await request(app)
      .post(`/projects/${project.id}/themes/select`)
      .set(authHeader())
      .send({ slug: "../../evil-theme; rm -rf /" });
    expect(res.status).toBe(400);
  });

  it("POST /:id/themes/select 404s for an unknown project", async () => {
    const res = await request(app).post("/projects/nope/themes/select").set(authHeader()).send({ slug: "astra" });
    expect(res.status).toBe(404);
  });

  it("selecting a theme moves the project to ENVIRONMENT_CREATING synchronously and kicks off the build pipeline", async () => {
    const project = await createProject(app);
    await driveToThemeSelection(app, project.id);

    const res = await request(app)
      .post(`/projects/${project.id}/themes/select`)
      .set(authHeader())
      .send({ slug: "astra" });
    expect(res.status).toBe(202);
    // The HTTP response itself proves the state transition is synchronous,
    // before the (fire-and-forget) build work has necessarily finished.
    expect(res.body.status).toBe("ENVIRONMENT_CREATING");
    expect(res.body.spec.theme.selected).toBe("astra");

    const ready = await waitForStatus(app, project.id, ["READY", "ERROR"]);
    expect(ready.status).toBe("READY");
  }, 20_000);

  it("merges a chosen design variant's palette into spec.design before the build starts", async () => {
    const project = await createProject(app);
    const afterRequirements = await driveToThemeSelection(app, project.id);
    const rec = afterRequirements.themeRecommendations[0];
    const variant = rec.variants?.[0];
    expect(variant).toBeDefined();

    const res = await request(app)
      .post(`/projects/${project.id}/themes/select`)
      .set(authHeader())
      .send({ slug: rec.theme.slug, variantId: variant!.id });
    expect(res.status).toBe(202);
    expect(res.body.spec.design.primary_color).toBe(variant!.primary_color);
    expect(res.body.spec.design.preset).toBe(variant!.preset);

    await waitForStatus(app, project.id, ["READY", "ERROR"]);
  }, 20_000);

  it("an invalid variantId is silently ignored -- theme selection still proceeds with the spec's existing design", async () => {
    const project = await createProject(app);
    await driveToThemeSelection(app, project.id);
    const before = await getProject(app, project.id);

    const res = await request(app)
      .post(`/projects/${project.id}/themes/select`)
      .set(authHeader())
      .send({ slug: "astra", variantId: "does-not-exist" });
    expect(res.status).toBe(202);
    expect(res.body.spec.design.primary_color).toBe(before.spec.design.primary_color);
  }, 20_000);
});
