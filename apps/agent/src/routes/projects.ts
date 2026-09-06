import { Router } from "express";
import { nanoid } from "nanoid";
import {
  EMPTY_SLOTS,
  emptySiteSpecification,
  type Project,
  type ProjectSummary,
  type SiteSpecification,
} from "@ai-wp/shared";
import { store } from "../db/store.js";
import { destroyEnvironment, restartEnvironment, startEnvironment, stopEnvironment } from "../docker/compose.js";
import { createBackup, createCheckpoint, restoreBackup, restoreCheckpoint } from "../tools/checkpoint.js";
import { exportProject, exportsListDir } from "../tools/export.js";
import { readScreenshot } from "../tools/screenshot.js";
import { applyEditIntent, applyDesignFieldsChange } from "../engine/incremental.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const projectsRouter = Router();

function toSummary(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    theme: p.spec.theme.selected,
    updatedAt: p.updatedAt,
    wpPort: p.docker.wpPort,
  };
}

projectsRouter.get("/", (_req, res) => {
  res.json(store.listProjects().map(toSummary));
});

projectsRouter.post("/", (req, res) => {
  const name = (req.body?.name as string | undefined)?.trim() || "Untitled Project";
  const now = new Date().toISOString();
  const project: Project = {
    id: nanoid(10),
    name,
    status: "CREATED",
    createdAt: now,
    updatedAt: now,
    slots: { ...EMPTY_SLOTS },
    spec: emptySiteSpecification(name),
    themeRecommendations: [],
    docker: {
      projectId: "",
      status: "none",
      wpPort: null,
      containerPrefix: "",
      previewUrl: null,
      adminUrl: null,
      createdAt: null,
      lastError: null,
    },
    log: [],
    auditLog: [],
    checkpoints: [],
    backups: [],
  };
  project.docker.projectId = project.id;
  project.status = "REQUIREMENTS";
  store.saveProject(project);
  res.status(201).json(project);
});

projectsRouter.get("/:id", (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
});

// REQ-06: inline requirements editing, separate from the chat flow. Applied
// as a spec merge pre-build; post-READY it's routed through the same
// incremental applier chat edits use, via one synthesized intent per changed
// field, so "edit the form" and "ask in chat" both end up making real,
// targeted tool calls rather than two different code paths.
projectsRouter.patch("/:id/spec", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const patch = req.body as Partial<SiteSpecification>;

  if (project.status !== "READY") {
    project.spec = { ...project.spec, ...patch, site: { ...project.spec.site, ...patch.site }, design: { ...project.spec.design, ...patch.design } };
    store.saveProject(project);
    return res.json(project);
  }

  const applied: string[] = [];
  const errors: string[] = [];
  async function tryApply(intent: Parameters<typeof applyEditIntent>[1]) {
    try {
      const r = await applyEditIntent(project!, intent);
      if (r.ok) applied.push(r.summary);
      else if (r.summary) errors.push(r.summary);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (patch.design?.primary_color && patch.design.primary_color !== project.spec.design.primary_color) {
    await tryApply({ kind: "change_color", color: patch.design.primary_color });
  }
  if (patch.design?.style && patch.design.style !== project.spec.design.style) {
    await tryApply({ kind: "change_style", style: patch.design.style });
  }
  // GEN-10: the rest of the design-system axes aren't EditIntents (see
  // applyDesignFieldsChange's own doc comment) -- applied directly here as
  // one combined change so a settings-form save that touches several of
  // them (e.g. both fonts at once) only re-ships the child theme CSS once.
  const designFieldPatch: Partial<SiteSpecification["design"]> = {};
  if (patch.design?.secondary_color && patch.design.secondary_color !== project.spec.design.secondary_color) {
    designFieldPatch.secondary_color = patch.design.secondary_color;
  }
  if (patch.design?.heading_font && patch.design.heading_font !== project.spec.design.heading_font) {
    designFieldPatch.heading_font = patch.design.heading_font;
  }
  if (patch.design?.body_font && patch.design.body_font !== project.spec.design.body_font) {
    designFieldPatch.body_font = patch.design.body_font;
  }
  if (patch.design?.radius && patch.design.radius !== project.spec.design.radius) {
    designFieldPatch.radius = patch.design.radius;
  }
  if (Object.keys(designFieldPatch).length > 0) {
    try {
      const r = await applyDesignFieldsChange(project, designFieldPatch);
      if (r.ok) applied.push(r.summary);
      else if (r.summary) errors.push(r.summary);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (patch.pages) {
    for (const slug of patch.pages) {
      if (!project.spec.pages.includes(slug)) {
        await tryApply({ kind: "add_page", slug, title: slug[0].toUpperCase() + slug.slice(1) });
      }
    }
    for (const slug of project.spec.pages) {
      if (!patch.pages.includes(slug)) {
        await tryApply({ kind: "remove_page", slug });
      }
    }
  }
  res.json({ project: store.getProject(project.id), applied, errors });
});

projectsRouter.delete("/:id", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (project.docker.status !== "none") {
    await destroyEnvironment(project).catch(() => undefined);
  }
  store.deleteProject(req.params.id);
  res.status(204).end();
});

projectsRouter.post("/:id/duplicate", (req, res) => {
  const source = store.getProject(req.params.id);
  if (!source) return res.status(404).json({ error: "Project not found" });
  const now = new Date().toISOString();
  const copy: Project = {
    ...source,
    id: nanoid(10),
    name: `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    status: "SPECIFICATION_READY",
    docker: { ...source.docker, status: "none", wpPort: null, previewUrl: null, adminUrl: null, createdAt: null },
    log: [],
    auditLog: [],
    checkpoints: [],
    backups: [],
  };
  store.saveProject(copy);
  res.status(201).json(copy);
});

// ---------------------------------------------------------------------------
// DOCK-04/05: environment lifecycle controls, all wired to real UI buttons.
// ---------------------------------------------------------------------------

projectsRouter.post("/:id/environment/stop", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    await stopEnvironment(project);
  } catch (e) {
    // Bug fix: this used to call res.json() again below even after already
    // responding here, which throws ERR_HTTP_HEADERS_ALREADY_SENT instead
    // of the intended 500.
    return res.status(500).json({ error: String(e) });
  }
  project.docker.status = "stopped";
  project.status = "STOPPED";
  store.saveProject(project);
  res.json(project);
});

projectsRouter.post("/:id/environment/start", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    await startEnvironment(project);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
  project.docker.status = "running";
  project.status = "READY";
  store.saveProject(project);
  res.json(project);
});

projectsRouter.post("/:id/environment/restart", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    await restartEnvironment(project);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
  project.docker.status = "running";
  store.saveProject(project);
  res.json(project);
});

// ---------------------------------------------------------------------------
// SEC-05: audit log readback.
// ---------------------------------------------------------------------------

projectsRouter.get("/:id/audit-log", (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project.auditLog);
});

// ---------------------------------------------------------------------------
// VER-02/03: checkpoints.
// ---------------------------------------------------------------------------

projectsRouter.get("/:id/checkpoints", (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project.checkpoints);
});

projectsRouter.post("/:id/checkpoints", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const label = (req.body?.label as string | undefined)?.trim() || "manual checkpoint";
  try {
    const checkpoint = await createCheckpoint(project, label, "manual");
    res.status(201).json(checkpoint);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

projectsRouter.post("/:id/checkpoints/:checkpointId/restore", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    await restoreCheckpoint(project, req.params.checkpointId);
    res.json(store.getProject(project.id));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// VER-04: full DB + filesystem backups.
// ---------------------------------------------------------------------------

projectsRouter.get("/:id/backups", (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project.backups);
});

projectsRouter.post("/:id/backups", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const label = (req.body?.label as string | undefined)?.trim() || "manual backup";
  try {
    const backup = await createBackup(project, label);
    res.status(201).json(backup);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

projectsRouter.post("/:id/backups/:backupId/restore", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    await restoreBackup(project, req.params.backupId);
    res.json(store.getProject(project.id));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// EXP-01/02: export bundle.
// ---------------------------------------------------------------------------

projectsRouter.post("/:id/export", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    const result = await exportProject(project);
    res.status(201).json({ relativePath: result.relativePath, bytes: result.bytes });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

projectsRouter.get("/:id/export/:file", (req, res) => {
  const file = join(exportsListDir(req.params.id), req.params.file);
  if (!existsSync(file)) return res.status(404).json({ error: "Export not found" });
  res.download(file);
});

// TST-03: screenshot readback (used by both the pipeline's own visual
// review and any manual "capture screenshot" trigger from the UI).
projectsRouter.get("/:id/screenshots/:file", (req, res) => {
  try {
    const buffer = readScreenshot(req.params.id, req.params.file);
    res.set("Content-Type", "image/png");
    res.send(buffer);
  } catch {
    res.status(404).json({ error: "Screenshot not found" });
  }
});
