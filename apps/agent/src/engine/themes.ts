import type { SiteSpecification, ThemeDefinition, ThemeRecommendation, ThemeVariant } from "@ai-wp/shared";

/**
 * Theme discovery + recommendation (spec sections 10-11).
 *
 * MVP scope per section 17: prioritize block/Gutenberg-compatible native
 * themes from the official WordPress.org repository over page-builder
 * ecosystems (Elementor/Divi), which need their own adapter later.
 *
 * This catalog is intentionally small and curated rather than a live
 * WordPress.org API search -- the real discovery call (`wp theme search`
 * over WP-CLI, or the themes.wordpress.org API) is a drop-in replacement
 * for THEME_CATALOG once the tool layer talks to a real environment; the
 * scoring function below doesn't care where the candidates came from.
 */

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

export function buildDesignVariants(spec: SiteSpecification): ThemeVariant[] {
  const base = spec.design.primary_color;
  const others = ACCENT_PALETTE.filter((c) => c.toLowerCase() !== base.toLowerCase());
  return [
    { id: "bold", label: "Bold", primary_color: others[0] ?? base, mode: "dark", font: "Inter" },
    { id: "minimal", label: "Minimal", primary_color: "#1B1D29", mode: "light", font: "IBM Plex Sans" },
    { id: "classic", label: "Classic", primary_color: others[1] ?? base, mode: "light", font: "Georgia" },
  ];
}

export async function recommendThemes(spec: SiteSpecification, limit = 3): Promise<ThemeRecommendation[]> {
  const useLive = process.env.THEME_SOURCE !== "catalog";
  const live = useLive ? await fetchWordPressOrgThemes(spec.site.type || spec.design.style || "wordpress", 6) : [];

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
