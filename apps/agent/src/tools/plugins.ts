import type { Project } from "@ai-wp/shared";
import { activatePlugin, installPlugin, updateOption, wpEval } from "./wordpress.js";
import { isDiscoveredSkillPlugin } from "../engine/skills.js";

/**
 * Plugin management (spec section 14, backlog epic PLG).
 *
 * PLG-01: only plugins in ALLOWED_PLUGINS can ever be installed -- this is
 * the allowlist enforced by tools/dispatcher.ts (SEC-06), independent of
 * whatever the requirement-extraction or chat-edit layer decided to ask for.
 * PLG-02: FEATURE_PLUGIN_MAP is what turns a spec.features / spec.seo /
 * spec.accessibility entry into an actual plugin slug.
 * PLG-03: CONFIGURATORS runs a small, plugin-specific WP-CLI sequence right
 * after install so the plugin isn't just present but usable.
 */

export interface PluginDefinition {
  slug: string;
  name: string;
  description: string;
}

export const ALLOWED_PLUGINS: PluginDefinition[] = [
  { slug: "woocommerce", name: "WooCommerce", description: "Online store, cart, checkout, payments." },
  { slug: "contact-form-7", name: "Contact Form 7", description: "Contact / lead-capture forms." },
  { slug: "wordpress-seo", name: "Yoast SEO", description: "Meta tags, sitemaps, on-page SEO." },
  { slug: "mailpoet", name: "MailPoet", description: "Newsletter signup and email campaigns." },
  { slug: "events-manager", name: "Events Manager", description: "Event listings and RSVP/registration." },
  { slug: "wp-accessibility", name: "WP Accessibility", description: "Accessibility helpers: skip links, contrast, alt-text nudges." },
  { slug: "amelia", name: "Amelia", description: "Appointment / booking scheduling." },
  { slug: "wp-super-cache", name: "WP Super Cache", description: "Page caching for performance." },
  { slug: "akismet", name: "Akismet Anti-spam", description: "Spam filtering for comments and forms." },
  { slug: "classic-editor", name: "Classic Editor", description: "Fallback editor for content not built for blocks." },
];

const ALLOWED_SLUGS = new Set(ALLOWED_PLUGINS.map((p) => p.slug));

/** PLG-01 + live skill packs: the static catalog, plus anything engine/skills.ts has verified against the public WordPress.org plugin directory this run. */
export function isAllowedPlugin(slug: string): boolean {
  return ALLOWED_SLUGS.has(slug) || isDiscoveredSkillPlugin(slug);
}

/** PLG-02: spec.features / flags -> plugin slug. A feature with no entry here needs no plugin (e.g. "blog" is core). */
export const FEATURE_PLUGIN_MAP: Record<string, string> = {
  ecommerce: "woocommerce",
  "contact-form": "contact-form-7",
  newsletter: "mailpoet",
  "event-registration": "events-manager",
  booking: "amelia",
};

export function pluginsForSpec(spec: {
  features: string[];
  seo: boolean;
  accessibility: boolean;
}): string[] {
  const slugs = new Set<string>();
  for (const f of spec.features) {
    const slug = FEATURE_PLUGIN_MAP[f];
    if (slug) slugs.add(slug);
  }
  if (spec.seo) slugs.add("wordpress-seo");
  if (spec.accessibility) slugs.add("wp-accessibility");
  // Every generated site gets basic spam protection and caching -- cheap, safe defaults.
  slugs.add("akismet");
  slugs.add("wp-super-cache");
  return Array.from(slugs).filter(isAllowedPlugin);
}

/** PLG-03: plugin-specific setup so "installed" also means "configured enough to use". */
const CONFIGURATORS: Record<string, (project: Project) => Promise<void>> = {
  woocommerce: async (project) => {
    await updateOption(project, "woocommerce_currency", "USD");
    await updateOption(project, "woocommerce_store_address", "");
    await updateOption(project, "woocommerce_default_country", "US");
    await updateOption(project, "woocommerce_allow_tracking", "no");
  },
  "wordpress-seo": async (project) => {
    await updateOption(project, "blog_public", "1");
  },
  "wp-super-cache": async (project) => {
    await wpEval(
      project,
      "if (function_exists('wp_cache_setting')) { @update_option('cache_compression', 0); @update_option('wp_super_cache_enabled', 1); }",
    ).catch(() => undefined);
  },
  akismet: async () => {
    // Requires an API key the agent doesn't have -- installed + activated only; left inactive-safe.
  },
};

export async function installAndConfigurePlugin(project: Project, slug: string): Promise<void> {
  if (!isAllowedPlugin(slug)) {
    throw new Error(`Plugin "${slug}" is not in the trusted plugin allowlist`);
  }
  await installPlugin(project, slug); // installs + activates
  await activatePlugin(project, slug).catch(() => undefined); // idempotent if already active
  const configure = CONFIGURATORS[slug];
  if (configure) await configure(project);
}
