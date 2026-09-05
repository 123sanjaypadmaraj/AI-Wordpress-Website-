import type { Project } from "@ai-wp/shared";
import type { EditIntent } from "./editIntent.js";
import { callTool } from "../tools/dispatcher.js";
import { createCheckpoint, restoreCheckpoint } from "../tools/checkpoint.js";
import { generateAndActivateChildTheme, regenerateChildThemeStyles } from "../tools/childtheme.js";
import { THEME_CATALOG } from "./themes.js";
import { generateCopy } from "./copywriter.js";
import { buildPageContent } from "./templates.js";
import { restartEnvironment } from "../docker/compose.js";
import { FEATURE_PLUGIN_MAP } from "../tools/plugins.js";
import { store } from "../db/store.js";

/**
 * GEN-09: applies exactly one EditIntent as a targeted operation -- never a
 * full pipeline re-run. Every mutating branch:
 *  1. snapshots an auto checkpoint first (so PRV-06's "undo" has something
 *     to restore to),
 *  2. calls only the specific tool(s) the change needs, via the dispatcher
 *     (so SEC-03/05/06's tier checks and audit log still apply to chat-driven
 *     edits, not just the initial build),
 *  3. updates project.spec to match, and persists.
 */

export interface IncrementalResult {
  summary: string;
  ok: boolean;
}

function parentThemeName(project: Project): string {
  const slug = project.spec.theme.selected;
  return THEME_CATALOG.find((t) => t.slug === slug)?.name ?? slug ?? "theme";
}

/**
 * Design-only edits (color/style) only need to re-ship the child theme's
 * CSS -- unless no child theme exists yet, e.g. a project built before
 * GEN-06/07 shipped, or one created with use_child_theme:false. In that
 * case, self-heal by generating one now rather than failing the edit.
 */
async function applyDesignChange(project: Project): Promise<void> {
  const parentSlug = project.spec.theme.selected;
  if (!parentSlug) return;
  try {
    await regenerateChildThemeStyles(project, parentSlug, parentThemeName(project));
  } catch {
    await generateAndActivateChildTheme(project, parentSlug, parentThemeName(project));
  }
  project.spec.theme.use_child_theme = true; // either path leaves the (now up to date) child theme active
}

export async function applyEditIntent(project: Project, intent: EditIntent): Promise<IncrementalResult> {
  if (intent.kind === "unknown") return { summary: "", ok: false };

  if (intent.kind !== "undo" && project.docker.status !== "running") {
    return { summary: "The environment isn't running, so I can't apply that change right now.", ok: false };
  }

  if (intent.kind !== "undo") {
    await createCheckpoint(project, `before: ${intent.kind}`, "auto").catch(() => undefined);
  }

  switch (intent.kind) {
    case "add_page": {
      if (project.spec.pages.includes(intent.slug)) {
        return { summary: `"${intent.title}" already exists as a page.`, ok: true };
      }
      const copy = await generateCopy(intent.slug, project.spec);
      const hasContactFormPlugin = project.spec.features.includes("contact-form");
      const content = buildPageContent(intent.slug, project.spec, copy, { hasContactFormPlugin });
      await callTool(project, "create_page", { title: intent.title, slug: intent.slug, content }, { source: "chat" });
      project.spec.pages.push(intent.slug);
      await callTool(project, "create_menu", { name: "Primary", pageSlugs: project.spec.pages }, { source: "chat" });
      store.saveProject(project);
      return { summary: `Added the "${intent.title}" page and updated navigation.`, ok: true };
    }

    case "remove_page": {
      if (!project.spec.pages.includes(intent.slug)) {
        return { summary: `There's no "${intent.slug}" page to remove.`, ok: true };
      }
      await callTool(project, "delete_page", { slug: intent.slug }, { source: "chat", confirm: true });
      project.spec.pages = project.spec.pages.filter((p) => p !== intent.slug);
      store.saveProject(project);
      return { summary: `Removed the "${intent.slug}" page and updated navigation.`, ok: true };
    }

    case "change_color": {
      project.spec.design.primary_color = intent.color;
      await applyDesignChange(project);
      store.saveProject(project);
      return { summary: `Updated the primary color to ${intent.color}.`, ok: true };
    }

    case "change_style": {
      project.spec.design.style = intent.style;
      if (intent.style === "futuristic") project.spec.design.mode = "dark";
      await applyDesignChange(project);
      store.saveProject(project);
      return { summary: `Switched the visual style to "${intent.style}".`, ok: true };
    }

    case "add_feature": {
      if (project.spec.features.includes(intent.feature)) {
        return { summary: `"${intent.feature}" is already enabled.`, ok: true };
      }
      project.spec.features.push(intent.feature);
      const slug = FEATURE_PLUGIN_MAP[intent.feature];
      if (slug) {
        await callTool(project, "install_plugin", { slug }, { source: "chat" });
      }
      store.saveProject(project);
      return { summary: `Enabled "${intent.feature}"${slug ? ` (installed ${slug})` : ""}.`, ok: true };
    }

    case "restart_environment": {
      await restartEnvironment(project);
      project.docker.status = "running";
      store.saveProject(project);
      return { summary: "Restarted the WordPress environment.", ok: true };
    }

    case "undo": {
      const last = [...project.checkpoints].reverse().find((c) => c.kind === "auto");
      if (!last) return { summary: "There's nothing to undo yet.", ok: false };
      await restoreCheckpoint(project, last.id);
      return { summary: `Restored the state from before "${last.label.replace(/^before: /, "")}".`, ok: true };
    }
  }
}
