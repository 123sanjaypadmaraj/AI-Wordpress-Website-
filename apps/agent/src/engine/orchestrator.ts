import type { Project, ProjectState } from "@ai-wp/shared";
import { store } from "../db/store.js";
import { createWordPressEnvironment } from "../docker/compose.js";
import { installWordPressCore, setHomepage, getContactFormId } from "../tools/wordpress.js";
import { callTool } from "../tools/dispatcher.js";
import { resolveThemeName } from "./themes.js";
import { generateCopy } from "./copywriter.js";
import { generateSupportingContent } from "./contentGenerator.js";
import { buildPageContent } from "./templates.js";
import { planPageLayout, bonusContentKeys } from "./layout.js";
import { pluginsForSpec } from "../tools/plugins.js";
import { discoverSkillPlugin } from "./skills.js";
import { generateAndActivateChildTheme } from "../tools/childtheme.js";
import { runSmokeSuite } from "./testRunner.js";
import { runVisualCritic } from "./critic.js";
import { createCheckpoint } from "../tools/checkpoint.js";
import { withRetry } from "./errors.js";

/**
 * Drives a project through the generation state machine (spec section 33):
 *
 *   THEME_SELECTION -> ENVIRONMENT_CREATING -> WORDPRESS_READY ->
 *   THEME_INSTALLING -> PLUGINS_INSTALLING -> GENERATING -> CONFIGURING ->
 *   TESTING -> VISUAL_REVIEW -> READY
 *
 * This runs after the user picks a theme. It's invoked fire-and-forget from
 * the route handler (spec section 41: long-running operations need visible
 * progress, not a blocking request) -- the frontend polls GET /projects/:id
 * and renders `project.log` + `project.status` as the progress checklist.
 *
 * Section 32 (error recovery): any step failure moves the project to ERROR
 * with the failure logged, rather than leaving it stuck silently. TST-07's
 * withRetry absorbs transient Docker/WP-CLI hiccups before that happens.
 */

function log(project: Project, message: string, level: "info" | "warn" | "error" = "info") {
  project.log.push({
    id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    projectId: project.id,
    timestamp: new Date().toISOString(),
    message,
    level,
  });
}

function setStatus(project: Project, status: ProjectState) {
  project.status = status;
  store.saveProject(project);
}

export async function runGenerationPipeline(projectId: string): Promise<void> {
  let project = store.getProject(projectId);
  if (!project) return;

  try {
    setStatus(project, "ENVIRONMENT_CREATING");
    log(project, "Creating isolated Docker WordPress environment");
    const { docker, log: dockerLog } = await withRetry(() => createWordPressEnvironment(project!), {
      retries: 1,
      onRetry: (attempt) => log(project!, `Retrying environment creation (attempt ${attempt + 1})`, "warn"),
    });
    project = store.getProject(projectId)!;
    project.docker = docker;
    dockerLog.forEach((l) => log(project!, l));

    if (docker.status === "error") {
      log(project, `Environment creation failed: ${docker.lastError}`, "error");
      setStatus(project, "ERROR");
      return;
    }
    store.saveProject(project);
    setStatus(project, "WORDPRESS_READY");
    log(project, `WordPress reachable at ${docker.previewUrl}`);

    setStatus(project, "THEME_INSTALLING");
    const themeSlug = project.spec.theme.selected ?? "twentytwentyfour";
    const themeName = resolveThemeName(project, themeSlug);
    log(project, `Installing WordPress core (title: "${project.spec.site.name}")`);
    await withRetry(() => installWordPressCore(project!));
    log(project, "Installing and activating theme: " + themeSlug);
    await callTool(project, "install_theme", { slug: themeSlug }, { source: "pipeline" });
    log(project, `Theme "${themeSlug}" active`);

    if (project.spec.theme.use_child_theme) {
      log(project, "Generating child theme to apply the AI-derived design system (GEN-06/07)");
      const childSlug = await generateAndActivateChildTheme(project, themeSlug, themeName);
      log(project, `Child theme "${childSlug}" active`);
    }

    // PLG-01/02/03: install + configure the plugins this spec actually needs.
    setStatus(project, "PLUGINS_INSTALLING");
    const plugins = pluginsForSpec(project.spec);
    for (const slug of plugins) {
      try {
        await callTool(project, "install_plugin", { slug }, { source: "pipeline" });
        log(project, `Installed and configured plugin: ${slug}`);
      } catch (err) {
        log(project, `Plugin "${slug}" failed to install: ${err instanceof Error ? err.message : err}`, "warn");
      }
    }

    // Live skill packs gathered during requirement-gathering (engine/skills.ts).
    // Re-verified against the WordPress.org directory here rather than trusted
    // off spec.discoveredSkills alone -- the in-memory live-allowlist a skill
    // joined at discovery time doesn't survive an agent restart, and
    // re-checking also catches a plugin that's since dropped below the
    // quality bar (pulled, abandoned, review-bombed).
    for (const skill of project.spec.discoveredSkills) {
      const verified = await discoverSkillPlugin(skill.query);
      if (verified?.slug !== skill.slug) {
        log(project, `Skipping skill "${skill.name}" -- no longer verifiable against the WordPress.org directory`, "warn");
        continue;
      }
      try {
        await callTool(project, "install_plugin", { slug: skill.slug }, { source: "pipeline" });
        log(project, `Installed skill: ${skill.name} (for "${skill.query}")`);
      } catch (err) {
        log(project, `Skill "${skill.name}" failed to install: ${err instanceof Error ? err.message : err}`, "warn");
      }
    }

    setStatus(project, "GENERATING");
    let homepageId: number | null = null;
    const contactFormId = plugins.includes("contact-form-7") ? await getContactFormId(project) : null;
    const hasWooCommerce = plugins.includes("woocommerce");
    for (const pageSlug of project.spec.pages) {
      const title = pageSlug.charAt(0).toUpperCase() + pageSlug.slice(1).replace(/-/g, " ");
      const copy = await generateCopy(pageSlug, project.spec); // GEN-05
      const layout = await planPageLayout(pageSlug, project.spec); // GEN-11
      const supportingContent = await generateSupportingContent(pageSlug, project.spec, bonusContentKeys(layout.bonus)); // GEN-05b
      const content = buildPageContent(pageSlug, project.spec, copy, { contactFormId, hasWooCommerce, content: supportingContent, layout }); // GEN-03/04
      const { id } = (await callTool(
        project,
        "create_page",
        { title, slug: pageSlug, content },
        { source: "pipeline" },
      )) as { id: number };
      if (pageSlug === "home") homepageId = id;
      log(project, `Created page: ${title}`);
    }
    if (homepageId) {
      await setHomepage(project, homepageId);
      log(project, "Set homepage as static front page");
    }

    setStatus(project, "CONFIGURING");
    await callTool(project, "create_menu", { name: "Primary", pageSlugs: project.spec.pages }, { source: "pipeline" });
    log(project, "Created primary navigation menu");

    // TST-01/02: automated smoke suite against the live site.
    setStatus(project, "TESTING");
    log(project, "Running automated smoke tests (page loads, nav links, forms, console errors)");
    try {
      const testResult = await runSmokeSuite(project);
      testResult.findings.forEach((f) => log(project!, `[test] ${f.message}`, f.level));
      log(project, testResult.passed ? "Smoke tests passed" : "Smoke tests found issues -- see above", testResult.passed ? "info" : "warn");
    } catch (err) {
      log(project, `Smoke tests could not run: ${err instanceof Error ? err.message : err}`, "warn");
    }

    // TST-03/04: screenshot + AI visual critic, with one bounded auto-fix.
    setStatus(project, "VISUAL_REVIEW");
    try {
      let critique = await runVisualCritic(project);
      if (critique.looksBlank && homepageId) {
        log(project, "Visual critic flagged a likely-blank homepage -- regenerating homepage copy once and re-checking", "warn");
        const copy = await generateCopy("home", project.spec);
        const layout = await planPageLayout("home", project.spec);
        const content = buildPageContent("home", project.spec, copy, { contactFormId, layout });
        await callTool(project, "update_page", { slug: "home", content }, { source: "pipeline" });
        critique = await runVisualCritic(project);
      }
      if (critique.issues.length) {
        critique.issues.forEach((issue) => log(project!, `[visual review] ${issue}`, "warn"));
      } else {
        log(project, "Visual review found no issues");
      }
    } catch (err) {
      log(project, `Visual review could not run: ${err instanceof Error ? err.message : err}`, "warn");
    }

    setStatus(project, "READY");
    log(project, "Website ready for live preview");

    // VER-02: baseline checkpoint once the build is actually usable, so
    // "undo" (PRV-06) always has a known-good state to fall back to.
    await createCheckpoint(project, "initial build", "auto").catch(() => undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = store.getProject(projectId);
    if (failed) {
      log(failed, `Generation failed: ${message}`, "error");
      setStatus(failed, "ERROR");
    }
  }
}
