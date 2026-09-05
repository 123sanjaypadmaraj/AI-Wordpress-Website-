import { Router } from "express";
import { store } from "../db/store.js";
import { recommendThemes, THEME_CATALOG, isAllowedTheme } from "../engine/themes.js";
import { runGenerationPipeline } from "../engine/orchestrator.js";

export const themesRouter = Router();

themesRouter.get("/:id/themes", async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(await recommendThemes(project.spec));
});

themesRouter.get("/catalog", (_req, res) => {
  res.json(THEME_CATALOG);
});

themesRouter.post("/:id/themes/select", (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const slug = req.body?.slug as string | undefined;
  const variantId = req.body?.variantId as string | undefined;
  if (!slug || !isAllowedTheme(slug)) {
    return res.status(400).json({ error: "Unknown theme slug" });
  }

  project.spec.theme.selected = slug;

  // THM-05: fold the chosen design variant into spec.design before the
  // build starts, so the swatch preview the user picked is what they get.
  if (variantId) {
    const rec = project.themeRecommendations.find((r) => r.theme.slug === slug);
    const variant = rec?.variants?.find((v) => v.id === variantId);
    if (variant) {
      project.spec.design.primary_color = variant.primary_color;
      project.spec.design.mode = variant.mode;
      project.spec.design.font = variant.font;
    }
  }

  project.status = "ENVIRONMENT_CREATING";
  project.log.push({
    id: `${Date.now()}`,
    projectId: project.id,
    timestamp: new Date().toISOString(),
    message: `Theme "${slug}" selected. Starting build pipeline.`,
    level: "info",
  });
  store.saveProject(project);

  // Fire-and-forget: the pipeline can take minutes (image pulls, WP
  // install). The frontend polls GET /projects/:id for status + log.
  void runGenerationPipeline(project.id);

  res.status(202).json(project);
});
