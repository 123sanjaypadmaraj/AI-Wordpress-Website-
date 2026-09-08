import type { Project, SiteSpecification } from "@ai-wp/shared";
import type { EditIntent } from "./editIntent.js";
import { callTool } from "../tools/dispatcher.js";
import { createCheckpoint } from "../tools/checkpoint.js";
import { generateAndActivateChildTheme, regenerateChildThemeStyles } from "../tools/childtheme.js";
import { resolveThemeName } from "./themes.js";
import { heuristicDesignSystem } from "./designSystem.js";
import { generateCopy } from "./copywriter.js";
import { generateSupportingContent } from "./contentGenerator.js";
import { buildPageContent } from "./templates.js";
import { planPageLayout, bonusContentKeys } from "./layout.js";
import { restartEnvironment } from "../docker/compose.js";
import { getContactFormId } from "../tools/wordpress.js";
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
  return resolveThemeName(project);
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

/**
 * GEN-10: settings-form-driven design edits (secondary color, heading/body
 * font, corner radius) -- unlike change_color/change_style, these aren't
 * things a chat message naturally expresses ("make the heading font
 * Playfair Display" is a plausible thing to type, but not one worth adding
 * NLU for yet), so this is called directly from routes/projects.ts's PATCH
 * /spec rather than being an EditIntent. Same checkpoint-first/rebuild-CSS
 * shape as applyDesignChange above.
 */
export async function applyDesignFieldsChange(
  project: Project,
  patch: Partial<Pick<SiteSpecification["design"], "secondary_color" | "heading_font" | "body_font" | "radius">>,
): Promise<IncrementalResult> {
  if (project.docker.status !== "running") {
    return { summary: "The environment isn't running, so I can't apply that change right now.", ok: false };
  }
  await createCheckpoint(project, "before: change_design", "auto").catch(() => undefined);
  Object.assign(project.spec.design, patch);
  await applyDesignChange(project);
  store.saveProject(project);
  return { summary: "Updated the design system.", ok: true };
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
      const layout = await planPageLayout(intent.slug, project.spec);
      const supportingContent = await generateSupportingContent(intent.slug, project.spec, bonusContentKeys(layout.bonus));
      const contactFormId = project.spec.features.includes("contact-form") ? await getContactFormId(project) : null;
      const hasWooCommerce = project.spec.features.includes("ecommerce");
      const content = buildPageContent(intent.slug, project.spec, copy, { contactFormId, hasWooCommerce, content: supportingContent, layout });
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
      // GEN-10: a style change should re-pick the preset it implies (font
      // pairing + corner radius), not just flip the `style` label while the
      // rest of the design system quietly keeps whatever it had before.
      const preset = heuristicDesignSystem(project.spec.design.style, project.spec.site.type, project.spec.design.primary_color, project.spec.design.mode);
      Object.assign(project.spec.design, preset);
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

    case "add_skill": {
      if (project.spec.discoveredSkills.some((s) => s.slug === intent.slug)) {
        return { summary: `"${intent.name}" is already installed.`, ok: true };
      }
      await callTool(project, "install_plugin", { slug: intent.slug }, { source: "chat" });
      project.spec.discoveredSkills.push({ slug: intent.slug, name: intent.name, query: intent.query, source: "wordpress.org" });
      store.saveProject(project);
      return {
        summary: `Installed "${intent.name}" (WordPress.org plugin directory) for "${intent.query}".`,
        ok: true,
      };
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
      // BUG FIX (found in task 06's integration-test pass): this used to call
      // tools/checkpoint.ts's restoreCheckpoint() directly, bypassing
      // tools/dispatcher.ts entirely -- the same class of P0 finding task 08
      // fixed for the *manual* restore route (routes/projects.ts's POST
      // /:id/checkpoints/:checkpointId/restore), which now goes through
      // callTool(..., "restore_checkpoint", ...). A chat-typed "undo" runs
      // the exact same real `wp db import` against the live site, yet had no
      // permission-tier gate and, more importantly, left zero trace in
      // project.auditLog -- SEC-05's audit trail is silently blind to every
      // chat-driven undo. Routing it through the dispatcher like every other
      // edit-intent branch above closes that gap; `confirm: true` here is the
      // user's own "undo" message, the equivalent of the manual route's HTTP
      // request being the explicit confirmation.
      await callTool(project, "restore_checkpoint", { checkpointId: last.id }, { confirm: true, source: "chat" });
      return { summary: `Restored the state from before "${last.label.replace(/^before: /, "")}".`, ok: true };
    }
  }
}
