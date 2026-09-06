import { Router } from "express";
import { store } from "../db/store.js";
import { callTool } from "../tools/dispatcher.js";
import { createCheckpoint } from "../tools/checkpoint.js";
import { getPage, listPages } from "../tools/wordpress.js";
import { rewritePageContent } from "../engine/copywriter.js";

export const contentRouter = Router();

/**
 * CMS-01: the in-app content editor (Content tab). Reads live from the
 * project's own WordPress via WP-CLI (tools/wordpress.ts) rather than a
 * separate content store, so what the editor shows can never drift from
 * what's actually live. Manual saves go through the same dispatcher every
 * other mutation does (SEC-03/05/06: permission tier + audit log), with an
 * auto-checkpoint first (VER-02) so an edit -- manual or AI-drafted -- is
 * always one "Restore" away from undone. The AI draft step itself never
 * touches WordPress: it only returns a suggestion for the editor to show,
 * the same title/content shape a manual edit would submit.
 */

function requireRunningProject(req: import("express").Request, res: import("express").Response) {
  const project = store.getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if (project.docker.status !== "running") {
    res.status(409).json({ error: "The environment isn't running, so pages can't be read or edited right now." });
    return null;
  }
  return project;
}

contentRouter.get("/:id/pages", async (req, res) => {
  const project = requireRunningProject(req, res);
  if (!project) return;
  try {
    res.json(await listPages(project));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

contentRouter.get("/:id/pages/:pageId", async (req, res) => {
  const project = requireRunningProject(req, res);
  if (!project) return;
  try {
    const page = await getPage(project, Number(req.params.pageId));
    if (!page) return res.status(404).json({ error: "Page not found" });
    res.json(page);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

contentRouter.put("/:id/pages/:pageId", async (req, res) => {
  const project = requireRunningProject(req, res);
  if (!project) return;
  const { title, content } = req.body as { title?: string; content?: string };
  if (title === undefined && content === undefined) {
    return res.status(400).json({ error: "Nothing to save -- provide title and/or content" });
  }
  const pageId = Number(req.params.pageId);
  const existing = await getPage(project, pageId);
  if (!existing) return res.status(404).json({ error: "Page not found" });

  try {
    await createCheckpoint(project, `before: edit page "${existing.slug}"`, "auto").catch(() => undefined);
    await callTool(project, "update_page", { slug: existing.slug, title, content }, { source: "manual" });
    res.json(await getPage(project, pageId));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// AI-assisted draft: returns a suggested {title, content} for the editor to
// show and let the user accept, tweak, or discard -- it never writes to
// WordPress itself, so there's nothing to check point or undo until the
// user actually saves (PUT above).
contentRouter.post("/:id/pages/:pageId/ai-draft", async (req, res) => {
  const project = requireRunningProject(req, res);
  if (!project) return;
  const instruction = (req.body?.instruction as string | undefined)?.trim();
  if (!instruction) return res.status(400).json({ error: "instruction is required" });

  const page = await getPage(project, Number(req.params.pageId));
  if (!page) return res.status(404).json({ error: "Page not found" });

  const draft = await rewritePageContent({
    siteName: project.spec.site.name,
    pageTitle: page.title,
    currentContent: page.content,
    instruction,
  });
  if (!draft) {
    return res.status(503).json({
      error: "AI isn't configured -- set ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY on the agent to use AI rewrite.",
    });
  }
  res.json(draft);
});
