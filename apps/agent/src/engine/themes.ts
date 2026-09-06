import type { Project, SiteSpecification, ThemeDefinition, ThemeRecommendation, ThemeVariant } from "@ai-wp/shared";
import { presetById, deriveSecondaryColor } from "./designSystem.js";

/**
 * Theme discovery + recommendation (spec sections 10-11).
 *
 * MVP scope per section 17: prioritize block/Gutenberg-compatible native
 * themes from the official WordPress.org repository over page-builder
 * ecosystems (Elementor/Divi), which need their own adapter later.
 *
 * THEME_CATALOG below is a small, hand-curated seed list -- mainly an
 * offline-safe floor (see THM-04 below) and a set of well-understood
 * defaults the scorer can lean on. It is deliberately NOT the main source
 * of what a user sees: recommendThemes() merges it with a live search of
 * the real themes.wordpress.org repository so the Themes tab shows a wide,
 * directly-imported catalog rather than just these six. The scoring
 * function doesn't care where a candidate came from.
 */

/** WordPress.org serves every hosted theme's screenshot from this predictable CDN path. */
function wpOrgScreenshotUrl(slug: string): string {
  return `https://ps.w.org/${slug}/screenshot.png`;
}

export const THEME_CATALOG: ThemeDefinition[] = [
  {
    slug: "twentytwentyfour",
    name: "Twenty Twenty-Four",
    category: ["business", "portfolio", "blog", "organization"],
    styleTags: ["minimal", "modern", "corporate"],
    blockThemeCompatible: true,
    maturity: 0.95,
    requiredPlugins: [],
    description: "WordPress's default full-site-editing theme. Extremely flexible block patterns, near-universal compatibility.",
    screenshotUrl: wpOrgScreenshotUrl("twentytwentyfour"),
  },
  {
    slug: "astra",
    name: "Astra",
    category: ["business", "agency", "ecommerce", "startup", "organization"],
    styleTags: ["minimal", "corporate", "premium"],
    blockThemeCompatible: true,
    maturity: 0.98,
    requiredPlugins: ["woocommerce"],
    description: "One of the most widely deployed WP themes. Lightweight, fast, deep starter-template library.",
    screenshotUrl: wpOrgScreenshotUrl("astra"),
  },
  {
    slug: "blocksy",
    name: "Blocksy",
    category: ["business", "portfolio", "ecommerce", "agency"],
    styleTags: ["modern", "bold", "premium"],
    blockThemeCompatible: true,
    maturity: 0.9,
    requiredPlugins: ["woocommerce"],
    description: "Modern block-first theme with strong header/footer builder and a large pattern library.",
    screenshotUrl: wpOrgScreenshotUrl("blocksy"),
  },
  {
    slug: "generatepress",
    name: "GeneratePress",
    category: ["business", "blog", "startup", "organization"],
    styleTags: ["minimal", "corporate"],
    blockThemeCompatible: true,
    maturity: 0.95,
    requiredPlugins: [],
    description: "Extremely lightweight, developer-favorite theme known for performance and clean markup.",
    screenshotUrl: wpOrgScreenshotUrl("generatepress"),
  },
  {
    slug: "neve",
    name: "Neve",
    category: ["startup", "agency", "portfolio", "restaurant"],
    styleTags: ["modern", "playful", "futuristic"],
    blockThemeCompatible: true,
    maturity: 0.85,
    requiredPlugins: [],
    description: "Fast, mobile-first theme with starter sites geared toward startups and creative agencies.",
    screenshotUrl: wpOrgScreenshotUrl("neve"),
  },
  {
    slug: "oceanwp",
    name: "OceanWP",
    category: ["ecommerce", "business", "restaurant", "club"],
    styleTags: ["corporate", "bold"],
    blockThemeCompatible: true,
    maturity: 0.9,
    requiredPlugins: ["woocommerce"],
    description: "Feature-rich multipurpose theme with strong WooCommerce integration out of the box.",
    screenshotUrl: wpOrgScreenshotUrl("oceanwp"),
  },
];

function score(theme: ThemeDefinition, spec: SiteSpecification): ThemeRecommendation {
  let points = 0;
  const reasons: string[] = [];

  if (theme.category.includes(spec.site.type)) {
    points += 40;
    reasons.push(`Built for "${spec.site.type}" sites`);
  }

  if (theme.styleTags.includes(spec.design.style)) {
    points += 30;
    reasons.push(`Matches the "${spec.design.style}" visual direction`);
  }

  if (theme.blockThemeCompatible) {
    points += 15;
    reasons.push("Full Gutenberg/block-editor support");
  }

  const needsEcommerce = spec.features.includes("ecommerce");
  const hasWoo = theme.requiredPlugins.includes("woocommerce");
  if (needsEcommerce && hasWoo) {
    points += 10;
    reasons.push("Proven WooCommerce integration for online payments");
  }
  if (!needsEcommerce && theme.requiredPlugins.length === 0) {
    points += 5;
    reasons.push("No required plugins -- lighter footprint");
  }

  points += Math.round(theme.maturity * 10);
  if (theme.maturity >= 0.9) reasons.push("Mature, actively maintained theme");

  return { theme, score: Math.min(100, points), reasons };
}

const catalogSlugs = new Set(THEME_CATALOG.map((t) => t.slug));
/** THM-04 results are appended here as they're fetched, so SEC-06's theme allowlist can trust them too (official WordPress.org repo only). */
const liveDiscoveredSlugs = new Set<string>();

export function isAllowedTheme(slug: string): boolean {
  return catalogSlugs.has(slug) || liveDiscoveredSlugs.has(slug);
}

/**
 * Display name for a selected theme slug. Most selections are now live
 * WordPress.org imports that never appear in THEME_CATALOG, so look at the
 * project's own recommendations (where the real `name` from the wp.org API
 * was captured) before falling back to the curated catalog or the bare slug.
 */
export function resolveThemeName(project: Pick<Project, "spec" | "themeRecommendations">, slug?: string): string {
  const themeSlug = slug ?? project.spec.theme.selected;
  if (!themeSlug) return "theme";
  const fromRecommendation = project.themeRecommendations?.find((r) => r.theme.slug === themeSlug)?.theme.name;
  const fromCatalog = THEME_CATALOG.find((t) => t.slug === themeSlug)?.name;
  return fromRecommendation ?? fromCatalog ?? themeSlug;
}

// ---------------------------------------------------------------------------
// THM-04: live WordPress.org theme search, merged with the curated catalog.
// Falls back to catalog-only (returns []) on any network failure/timeout so
// dev with no internet access still works -- recommendThemes always has the
// curated six as a floor.
// ---------------------------------------------------------------------------

interface WpOrgThemeApiResult {
  slug: string;
  name: string;
  tags?: Record<string, string>;
  description?: string;
  rating?: number;
  active_installs?: number;
  requires_plugins?: string[];
  screenshot_url?: string;
}

const searchCache = new Map<string, { at: number; results: ThemeDefinition[] }>();
const CACHE_TTL_MS = 5 * 60_000;

function inferCategoryAndStyle(tags: string[]): { category: string[]; styleTags: string[] } {
  const categoryTagMap: Record<string, string> = {
    business: "business", ecommerce: "ecommerce", shop: "ecommerce", portfolio: "portfolio",
    blog: "blog", education: "organization", nonprofit: "nonprofit", "e-commerce": "ecommerce",
    restaurant: "restaurant", "one-page": "startup", magazine: "blog", photography: "portfolio",
  };
  const styleTagMap: Record<string, string> = {
    minimal: "minimal", dark: "futuristic", light: "minimal", modern: "modern", bold: "bold",
    elegant: "premium", corporate: "corporate", playful: "playful", colorful: "playful",
  };
  const category = new Set<string>();
  const styleTags = new Set<string>();
  for (const tag of tags) {
    if (categoryTagMap[tag]) category.add(categoryTagMap[tag]);
    if (styleTagMap[tag]) styleTags.add(styleTagMap[tag]);
  }
  if (category.size === 0) category.add("business");
  if (styleTags.size === 0) styleTags.add("modern");
  return { category: Array.from(category), styleTags: Array.from(styleTags) };
}

export async function fetchWordPressOrgThemes(query: string, limit = 6): Promise<ThemeDefinition[]> {
  const cacheKey = `${query}::${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const url = new URL("https://api.wordpress.org/themes/info/1.2/");
    url.searchParams.set("action", "query_themes");
    url.searchParams.set("request[search]", query);
    url.searchParams.set("request[per_page]", String(limit));
    url.searchParams.set("request[fields][description]", "1");
    url.searchParams.set("request[fields][tags]", "1");
    url.searchParams.set("request[fields][screenshot_url]", "1");

    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { themes?: WpOrgThemeApiResult[] };
    const results = (body.themes ?? [])
      .filter((t) => !catalogSlugs.has(t.slug)) // curated catalog already covers these when present
      .map((t): ThemeDefinition => {
        const tags = Object.keys(t.tags ?? {});
        const { category, styleTags } = inferCategoryAndStyle(tags);
        liveDiscoveredSlugs.add(t.slug);
        return {
          slug: t.slug,
          name: t.name,
          category,
          styleTags,
          blockThemeCompatible: tags.includes("full-site-editing") || tags.includes("block-patterns"),
          maturity: Math.min(1, (t.rating ?? 60) / 100),
          requiredPlugins: [],
          description: (t.description ?? "").replace(/<[^>]*>/g, "").slice(0, 220),
          screenshotUrl: t.screenshot_url || wpOrgScreenshotUrl(t.slug),
        };
      });
    searchCache.set(cacheKey, { at: Date.now(), results });
    return results;
  } catch {
    return []; // offline / API down -- caller falls back to the curated catalog
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// THM-05: design-system variants a user can flip between before the build
// starts. These aren't separate WordPress instances (that would mean N
// docker stacks per candidate theme) -- they're swatch-level previews the
// frontend renders directly, and the chosen one is merged into spec.design.
// ---------------------------------------------------------------------------

const ACCENT_PALETTE = ["#3651D4", "#1E8E5A", "#C43D4B", "#B8790A", "#6D3FD1", "#1A9E8F"];

/**
 * GEN-10: each variant is now a full design-system bundle (one of
 * designSystem.ts's curated presets, with its own mode/radius/font pairing)
 * rather than just a different primary color -- picking a variant actually
 * picks a distinct look, not a re-tinted version of the same one. The three
 * labels (Bold/Minimal/Classic) are kept stable since the frontend and any
 * saved project already key off them, but what's behind each is richer.
 */
export function buildDesignVariants(spec: SiteSpecification): ThemeVariant[] {
  const base = spec.design.primary_color;
  const others = ACCENT_PALETTE.filter((c) => c.toLowerCase() !== base.toLowerCase());

  const bundles: Array<{ id: string; label: string; presetId: string; primary_color: string; mode: "light" | "dark" }> = [
    { id: "bold", label: "Bold", presetId: "bold", primary_color: others[0] ?? base, mode: "dark" },
    { id: "minimal", label: "Minimal", presetId: "minimal", primary_color: "#1B1D29", mode: "light" },
    { id: "classic", label: "Classic", presetId: "editorial", primary_color: others[1] ?? base, mode: "light" },
  ];

  return bundles.map(({ id, label, presetId, primary_color, mode }) => {
    const preset = presetById(presetId);
    return {
      id,
      label,
      primary_color,
      secondary_color: deriveSecondaryColor(primary_color, mode),
      mode,
      heading_font: preset.headingFont,
      body_font: preset.bodyFont,
      radius: preset.radius,
      preset: preset.id,
    };
  });
}

// Default result count and per-query live fetch size are both overridable
// so an operator can dial them without a code change; the important part is
// the *default* is now "browse a real WordPress.org catalog", not "here are
// the 3 best of a 6-theme handwritten shortlist".
const DEFAULT_RESULT_LIMIT = Number(process.env.THEME_RESULT_LIMIT) || 24;
const DEFAULT_LIVE_FETCH_LIMIT = Number(process.env.THEME_LIVE_FETCH_LIMIT) || 30;

export async function recommendThemes(
  spec: SiteSpecification,
  limit = DEFAULT_RESULT_LIMIT,
): Promise<ThemeRecommendation[]> {
  const useLive = process.env.THEME_SOURCE !== "catalog";

  // Search WordPress.org from a few angles (site type, visual style, and a
  // bare "wordpress" query for general popular coverage) rather than one
  // narrow term, then dedupe by slug -- this is what actually gets the user
  // "way more themes" instead of six curated ones plus a thin single-query tail.
  const queries = Array.from(new Set([spec.site.type, spec.design.style, "wordpress"].filter(Boolean))) as string[];
  const liveBatches = useLive
    ? await Promise.all(queries.map((q) => fetchWordPressOrgThemes(q, DEFAULT_LIVE_FETCH_LIMIT)))
    : [];
  const seenLiveSlugs = new Set<string>();
  const live: ThemeDefinition[] = [];
  for (const batch of liveBatches) {
    for (const theme of batch) {
      if (seenLiveSlugs.has(theme.slug)) continue;
      seenLiveSlugs.add(theme.slug);
      live.push(theme);
    }
  }

  const candidates = [
    ...THEME_CATALOG.map((t) => ({ theme: t, source: "catalog" as const })),
    ...live.map((t) => ({ theme: t, source: "wordpress.org" as const })),
  ];

  return candidates
    .map(({ theme, source }) => ({ ...score(theme, spec), source }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((rec) => ({ ...rec, variants: buildDesignVariants(spec) }));
}
