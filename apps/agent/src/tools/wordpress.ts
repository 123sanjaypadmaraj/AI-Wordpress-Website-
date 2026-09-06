import { execWpCli, readProjectSecret } from "../docker/compose.js";
import type { CmsPageDetail, CmsPageSummary, Project } from "@ai-wp/shared";

/**
 * WordPress Agent Tool Layer (spec section 16).
 *
 * Every function here is one of the *controlled* tools the AI agent is
 * allowed to call -- it never gets a raw shell. Each tool shells out to
 * WP-CLI inside the project's `wpcli` container (never the host), which is
 * the same trust boundary wp-admin itself would enforce.
 *
 * This is deliberately a thin wrapper: the interesting behavior (what pages
 * to create, which theme to pick) lives in the engine/ modules and the
 * orchestrator that calls these tools, not here. Keeping the tool layer
 * "dumb" is what makes it auditable (section 40) and safe to expose to an
 * LLM (section 38).
 */

function wp(project: Project, args: string[]) {
  return execWpCli(project.id, args);
}

export async function installWordPressCore(project: Project) {
  const url = `http://localhost:${project.docker.wpPort}`;
  const adminUser = readProjectSecret(project.id, "WP_ADMIN_USER") ?? "admin";
  const adminPassword = readProjectSecret(project.id, "WP_ADMIN_PASSWORD");
  const adminEmail = readProjectSecret(project.id, "WP_ADMIN_EMAIL") ?? "admin@example.local";
  if (!adminPassword) throw new Error("Missing generated admin password for project");

  const { stdout: alreadyInstalled } = await wp(project, ["core", "is-installed", "--quiet"]).catch(() => ({
    stdout: "",
  }));
  void alreadyInstalled;

  await wp(project, [
    "core",
    "install",
    `--url=${url}`,
    `--title=${project.spec.site.name}`,
    `--admin_user=${adminUser}`,
    `--admin_password=${adminPassword}`,
    `--admin_email=${adminEmail}`,
    "--skip-email",
  ]);

  await wp(project, ["option", "update", "permalink_structure", "/%postname%/"]);
  await wp(project, ["option", "update", "timezone_string", "UTC"]);
}

export async function installTheme(project: Project, slug: string) {
  await wp(project, ["theme", "install", slug, "--activate"]);
}

export async function activateTheme(project: Project, slug: string) {
  await wp(project, ["theme", "activate", slug]);
}

export async function installPlugin(project: Project, slug: string) {
  await wp(project, ["plugin", "install", slug, "--activate"]);
}

export async function activatePlugin(project: Project, slug: string) {
  await wp(project, ["plugin", "activate", slug]);
}

export async function isPluginActive(project: Project, slug: string): Promise<boolean> {
  // `wp plugin is-active` exits non-zero (rejects) when the plugin is inactive or missing.
  return wp(project, ["plugin", "is-active", slug]).then(
    () => true,
    () => false,
  );
}

/** Runs a single WP-CLI option update -- the primitive PLG-03's per-plugin configurators build on. */
export async function updateOption(project: Project, key: string, value: string) {
  await wp(project, ["option", "update", key, value]);
}

/** Evaluates a small PHP snippet inside the WordPress runtime (used sparingly, e.g. for wp_update_custom_css_post). */
export async function wpEval(project: Project, php: string) {
  await wp(project, ["eval", php]);
}

export interface PageSpec {
  title: string;
  slug: string;
  content: string;
}

export async function createPage(project: Project, page: PageSpec): Promise<number> {
  const { stdout } = await wp(project, [
    "post",
    "create",
    "--post_type=page",
    `--post_title=${page.title}`,
    `--post_name=${page.slug}`,
    `--post_status=publish`,
    "--porcelain",
  ]);
  const postId = Number(stdout.trim());
  if (page.content) {
    await wp(project, ["post", "update", String(postId), `--post_content=${page.content}`]);
  }
  return postId;
}

export async function setHomepage(project: Project, pageId: number) {
  await wp(project, ["option", "update", "show_on_front", "page"]);
  await wp(project, ["option", "update", "page_on_front", String(pageId)]);
}

/**
 * Resolves a page's post ID from its slug. Needed because WP-CLI subcommands
 * run one at a time over `docker compose exec` (no shell in between), so a
 * command can't pipe/substitute another WP-CLI call's output the way it
 * could on an interactive terminal -- each lookup has to be its own exec.
 */
export async function getPageIdBySlug(project: Project, slug: string): Promise<number | null> {
  const { stdout } = await wp(project, [
    "post",
    "list",
    "--post_type=page",
    `--name=${slug}`,
    "--field=ID",
    "--post_status=publish,draft,future",
  ]).catch(() => ({ stdout: "" }));
  const id = Number(stdout.trim().split("\n")[0]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function updatePage(project: Project, id: number, fields: { title?: string; content?: string }) {
  const args = ["post", "update", String(id)];
  if (fields.title !== undefined) args.push(`--post_title=${fields.title}`);
  if (fields.content !== undefined) args.push(`--post_content=${fields.content}`);
  if (args.length > 3) await wp(project, args);
}

export async function deletePage(project: Project, id: number) {
  await wp(project, ["post", "delete", String(id), "--force"]);
}

/**
 * CMS-01: the page list + per-page content the in-app content editor reads.
 * Deliberately reads live from WP-CLI rather than mirroring pages into
 * `project.spec` or a separate store -- the editor can never show stale
 * content, and a manual `wp-admin` edit is picked up on next load too.
 */
export async function listPages(project: Project): Promise<CmsPageSummary[]> {
  const { stdout } = await wp(project, [
    "post",
    "list",
    "--post_type=page",
    "--post_status=publish,draft,future,private",
    "--fields=ID,post_title,post_name,post_status",
    "--format=json",
    "--orderby=title",
    "--order=ASC",
  ]).catch(() => ({ stdout: "" }));
  try {
    const rows = JSON.parse(stdout || "[]") as Array<{
      ID: string;
      post_title: string;
      post_name: string;
      post_status: string;
    }>;
    return rows.map((r) => ({ id: Number(r.ID), title: r.post_title, slug: r.post_name, status: r.post_status }));
  } catch {
    return [];
  }
}

export async function getPage(project: Project, id: number): Promise<CmsPageDetail | null> {
  const { stdout } = await wp(project, [
    "post",
    "get",
    String(id),
    "--fields=ID,post_title,post_name,post_status,post_content",
    "--format=json",
  ]).catch(() => ({ stdout: "" }));
  if (!stdout.trim()) return null;
  try {
    const row = JSON.parse(stdout) as {
      ID: string;
      post_title: string;
      post_name: string;
      post_status: string;
      post_content: string;
    };
    return {
      id: Number(row.ID),
      title: row.post_title,
      slug: row.post_name,
      status: row.post_status,
      content: row.post_content,
    };
  } catch {
    return null;
  }
}

async function existingMenuSlugs(project: Project, menuName: string): Promise<Set<string>> {
  const { stdout } = await wp(project, [
    "menu",
    "item",
    "list",
    menuName,
    "--fields=object_id",
    "--format=csv",
  ]).catch(() => ({ stdout: "" }));
  const ids = new Set(
    stdout
      .split("\n")
      .slice(1) // header row
      .map((l) => l.trim())
      .filter(Boolean),
  );
  return ids;
}

export async function createMenu(project: Project, name: string, pageSlugs: string[]) {
  await wp(project, ["menu", "create", name]).catch(() => undefined); // idempotent-ish for re-runs
  const already = await existingMenuSlugs(project, name);
  for (const slug of pageSlugs) {
    const pageId = await getPageIdBySlug(project, slug);
    if (!pageId || already.has(String(pageId))) continue;
    await wp(project, ["menu", "item", "add-post", name, String(pageId)]).catch(() => undefined);
  }
  await wp(project, ["menu", "location", "assign", name, "primary"]).catch(() => undefined);
}

/** Removes a single page from the primary menu -- used by the incremental editor (GEN-09) when a page is removed. */
export async function removeMenuItemForPage(project: Project, menuName: string, pageId: number) {
  const { stdout } = await wp(project, [
    "menu",
    "item",
    "list",
    menuName,
    "--fields=db_id,object_id",
    "--format=csv",
  ]).catch(() => ({ stdout: "" }));
  const row = stdout
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .find(([, objectId]) => Number(objectId) === pageId);
  if (row) await wp(project, ["menu", "item", "delete", row[0]]).catch(() => undefined);
}

export async function addCustomCss(project: Project, css: string) {
  const encoded = css.replace(/'/g, "'\\''");
  await wp(project, ["eval", `wp_update_custom_css_post('${encoded}');`]);
}

/**
 * Contact Form 7's shortcode requires an explicit form id -- `[contact-form-7]`
 * with no id renders "Error: Contact form not found" instead of a form, even
 * though the plugin auto-creates a default "Contact form 1" post on
 * activation. Looks that default form up so the generated shortcode can
 * reference it by id.
 */
export async function getContactFormId(project: Project): Promise<number | null> {
  const { stdout } = await wp(project, [
    "post",
    "list",
    "--post_type=wpcf7_contact_form",
    "--field=ID",
    "--posts_per_page=1",
    "--orderby=ID",
    "--order=ASC",
  ]).catch(() => ({ stdout: "" }));
  const id = Number(stdout.trim().split("\n")[0]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function getSiteStatus(project: Project) {
  const { stdout } = await wp(project, ["core", "version"]);
  return { coreVersion: stdout.trim() };
}
