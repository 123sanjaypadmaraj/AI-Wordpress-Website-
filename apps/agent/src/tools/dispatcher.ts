import { nanoid } from "nanoid";
import type { AuditLogEntry, Project, ToolName } from "@ai-wp/shared";
import { TOOL_PERMISSIONS } from "@ai-wp/shared";
import { store } from "../db/store.js";
import { withRetry } from "../engine/errors.js";
import { isAllowedTheme } from "../engine/themes.js";
import { isAllowedPlugin, installAndConfigurePlugin } from "./plugins.js";
import {
  activateTheme,
  createMenu,
  createPage,
  deletePage,
  getPageIdBySlug,
  installTheme,
  setHomepage,
  updatePage,
} from "./wordpress.js";
import { execWpCli } from "../docker/compose.js";
import { captureScreenshot } from "./screenshot.js";

/**
 * SEC-03/05/06: every WordPress-affecting operation -- whether triggered by
 * the build pipeline, a post-READY chat edit (PRV-04/GEN-09), or a plugin
 * install (PLG-01) -- goes through this single chokepoint. It:
 *
 *  1. Enforces the permission tier from TOOL_PERMISSIONS (SEC-03):
 *     "destructive" calls are rejected unless the caller explicitly confirms.
 *  2. Enforces source allowlists (SEC-06): only catalog/WordPress.org themes
 *     and only ALLOWED_PLUGINS plugins can ever be installed, no matter what
 *     asked for them.
 *  3. Records a redacted, structured entry in project.auditLog (SEC-05) for
 *     every attempt, success or failure.
 *  4. Wraps the underlying call in TST-07's bounded retry for transient
 *     Docker/WP-CLI failures.
 *
 * This is intentionally the *only* place that calls into tools/wordpress.ts
 * and tools/plugins.ts from outside the initial-build orchestrator, so an
 * LLM-driven edit intent can never bypass the tier/allowlist checks.
 */

export interface DispatchOptions {
  confirm?: boolean;
  source: AuditLogEntry["source"];
  retries?: number;
}

const SAFE_WP_SUBCOMMANDS = new Set(["post", "option", "theme", "plugin", "menu", "core", "cache", "transient"]);

function redact(args: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    clone[k] = /password|secret|token|key/i.test(k) ? "[redacted]" : v;
  }
  return clone;
}

async function execute(project: Project, tool: ToolName, args: Record<string, unknown>): Promise<unknown> {
  switch (tool) {
    case "install_theme": {
      const slug = String(args.slug);
      if (!isAllowedTheme(slug)) throw new Error(`Unknown theme slug "${slug}" -- not in the trusted theme allowlist`);
      return installTheme(project, slug);
    }
    case "activate_theme": {
      const slug = String(args.slug);
      if (!isAllowedTheme(slug)) throw new Error(`Unknown theme slug "${slug}" -- not in the trusted theme allowlist`);
      return activateTheme(project, slug);
    }
    case "install_plugin": {
      const slug = String(args.slug);
      if (!isAllowedPlugin(slug)) throw new Error(`Plugin "${slug}" is not in the trusted plugin allowlist`);
      return installAndConfigurePlugin(project, slug);
    }
    case "activate_plugin": {
      const slug = String(args.slug);
      if (!isAllowedPlugin(slug)) throw new Error(`Plugin "${slug}" is not in the trusted plugin allowlist`);
      return installAndConfigurePlugin(project, slug);
    }
    case "create_page": {
      const { title, slug, content } = args as { title: string; slug: string; content?: string };
      const id = await createPage(project, { title, slug, content: content ?? "" });
      return { id };
    }
    case "update_page": {
      const { slug, title, content } = args as { slug: string; title?: string; content?: string };
      const id = await getPageIdBySlug(project, slug);
      if (!id) throw new Error(`No existing page with slug "${slug}"`);
      await updatePage(project, id, { title, content });
      return { id };
    }
    case "delete_page": {
      const { slug } = args as { slug: string };
      const id = await getPageIdBySlug(project, slug);
      if (!id) throw new Error(`No existing page with slug "${slug}"`);
      await deletePage(project, id);
      await createMenu(project, "Primary", project.spec.pages.filter((p) => p !== slug));
      return { id };
    }
    case "create_menu": {
      const { name, pageSlugs } = args as { name: string; pageSlugs: string[] };
      return createMenu(project, name, pageSlugs);
    }
    case "update_site_settings": {
      const { homepageSlug } = args as { homepageSlug?: string };
      if (homepageSlug) {
        const id = await getPageIdBySlug(project, homepageSlug);
        if (id) await setHomepage(project, id);
      }
      return {};
    }
    case "capture_screenshot": {
      const { path } = args as { path?: string };
      return captureScreenshot(project, path);
    }
    case "run_wp_cli": {
      const wpArgs = args.args as string[];
      if (!Array.isArray(wpArgs) || wpArgs.length === 0 || !SAFE_WP_SUBCOMMANDS.has(wpArgs[0])) {
        throw new Error(
          `run_wp_cli is restricted to: ${Array.from(SAFE_WP_SUBCOMMANDS).join(", ")} (got "${wpArgs?.[0]}")`,
        );
      }
      const { stdout } = await execWpCli(project.id, wpArgs);
      return { stdout };
    }
    default:
      throw new Error(`Tool "${tool}" is not implemented in the dispatcher yet`);
  }
}

export async function callTool(
  project: Project,
  tool: ToolName,
  args: Record<string, unknown>,
  opts: DispatchOptions,
): Promise<unknown> {
  const permission = TOOL_PERMISSIONS[tool];

  const started = Date.now();
  let ok = true;
  let error: string | null = null;
  let result: unknown;
  try {
    // SECURITY FIX (2026-09-06): this confirmation gate used to run *before*
    // the try/finally below, so a destructive call rejected for missing
    // confirmation threw straight out of callTool and never reached the
    // audit-log write -- the one class of call this module's own header
    // comment promises to record "for every attempt, success or failure"
    // was silently invisible to SEC-05's audit trail. Moved inside the try
    // so a permission-tier rejection is now audited exactly like an
    // allowlist rejection or an execution failure. Also hardened the check
    // to `!== true` (was `!opts.confirm`): DispatchOptions.confirm is typed
    // boolean, but callers that build `opts` from untyped/JSON input (a
    // route body, a deserialized tool call) could otherwise pass a truthy
    // non-boolean like the string "false" and have it treated as confirmed.
    if (permission === "destructive" && opts.confirm !== true) {
      throw new Error(`Tool "${tool}" is destructive and requires explicit confirmation`);
    }
    result = await withRetry(() => execute(project, tool, args), { retries: opts.retries ?? 1 });
    return result;
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const entry: AuditLogEntry = {
      id: nanoid(10),
      projectId: project.id,
      timestamp: new Date().toISOString(),
      tool,
      permission,
      args: redact(args),
      ok,
      error,
      durationMs: Date.now() - started,
      source: opts.source,
    };
    project.auditLog.push(entry);
    if (project.auditLog.length > 300) project.auditLog.splice(0, project.auditLog.length - 300);
    store.saveProject(project);
  }
}
