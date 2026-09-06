import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emptySiteSpecification } from "@ai-wp/shared";
import type { SiteSpecification } from "@ai-wp/shared";
import {
  THEME_CATALOG,
  isAllowedTheme,
  resolveThemeName,
  recommendThemes,
  buildDesignVariants,
} from "../../../../apps/agent/src/engine/themes.js";

/**
 * themes.ts has no AI-provider branch of its own (recommendThemes/
 * buildDesignVariants never touch llm/client.ts) -- its two "modes" are
 * catalog-only vs. catalog+live-wordpress.org-search, gated by fetch, not by
 * an AI provider. designSystem.ts's own AI path is covered in
 * designSystem.test.ts; here we only reuse its deterministic pieces
 * (presetById/deriveSecondaryColor) via buildDesignVariants.
 */

function makeSpec(overrides: Partial<SiteSpecification> = {}): SiteSpecification {
  const base = emptySiteSpecification("Acme");
  return {
    ...base,
    ...overrides,
    site: { ...base.site, ...(overrides.site ?? {}) },
    design: { ...base.design, ...(overrides.design ?? {}) },
  };
}

describe("engine/themes.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("catalog scoring/sorting (recommendThemes)", () => {
    it("orders the curated catalog by score, highest first, for an ecommerce/bold spec", async () => {
      vi.stubEnv("THEME_SOURCE", "catalog");
      const spec = makeSpec({
        site: { name: "Acme", type: "ecommerce", industry: "retail", audience: [] },
        features: ["ecommerce"],
        design: { ...emptySiteSpecification().design, style: "bold" },
      });

      const results = await recommendThemes(spec);

      // Expected via the documented scoring formula:
      //  blocksy/oceanwp: category+style+block+woo+maturity -> capped at 100 (tie, catalog order preserved)
      //  astra: category+block+woo+maturity -> 75
      //  twentytwentyfour/generatepress: block+maturity only -> 25 (tie)
      //  neve: block+maturity only, lower maturity -> 24
      expect(results.map((r) => r.theme.slug)).toEqual([
        "blocksy",
        "oceanwp",
        "astra",
        "twentytwentyfour",
        "generatepress",
        "neve",
      ]);
      expect(results[0].score).toBe(100);
      expect(results[1].score).toBe(100);
      expect(results[2].score).toBe(75);
      expect(results[3].score).toBe(25);
      expect(results[4].score).toBe(25);
      expect(results[5].score).toBe(24);
    });

    it("gives every result a reasons list explaining its score, and attaches THM-05 variants", async () => {
      vi.stubEnv("THEME_SOURCE", "catalog");
      const spec = makeSpec({ site: { name: "Acme", type: "portfolio", industry: "art", audience: [] } });

      const results = await recommendThemes(spec);

      for (const rec of results) {
        expect(rec.reasons.length).toBeGreaterThan(0);
        expect(rec.variants).toHaveLength(3);
        expect(rec.source).toBe("catalog");
      }
    });

    it("does not call fetch at all when THEME_SOURCE=catalog", async () => {
      vi.stubEnv("THEME_SOURCE", "catalog");
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await recommendThemes(makeSpec());
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("respects the limit parameter after sorting", async () => {
      vi.stubEnv("THEME_SOURCE", "catalog");
      const results = await recommendThemes(makeSpec(), 2);
      expect(results).toHaveLength(2);
    });
  });

  describe("THM-04: live wordpress.org search merge + failure fallback", () => {
    it("falls back to the curated catalog without throwing when the live search fails outright", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

      const spec = makeSpec({
        site: { name: "Acme", type: "ecommerce", industry: "retail", audience: [] },
        features: ["ecommerce"],
        design: { ...emptySiteSpecification().design, style: "bold" },
      });

      await expect(recommendThemes(spec)).resolves.not.toThrow();
      const results = await recommendThemes(spec);
      // Still exactly the 6 curated catalog entries, same order as the pure-catalog test.
      expect(results.map((r) => r.theme.slug)).toEqual([
        "blocksy",
        "oceanwp",
        "astra",
        "twentytwentyfour",
        "generatepress",
        "neve",
      ]);
      expect(results.every((r) => r.source === "catalog")).toBe(true);
    });

    it("falls back to the curated catalog without throwing when the API responds non-OK", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
      const results = await recommendThemes(makeSpec());
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.source === "catalog")).toBe(true);
    });

    it("merges a successful live search result in, marked with source wordpress.org, and dedupes against the catalog", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            themes: [
              // Already in the curated catalog -- must be filtered out, not duplicated.
              { slug: "astra", name: "Astra (dupe)" },
              // A genuinely new live result.
              {
                slug: "brand-new-theme",
                name: "Brand New Theme",
                tags: { ecommerce: "ecommerce", modern: "modern" },
                rating: 92,
                description: "<p>A shiny new theme.</p>",
              },
            ],
          }),
          { status: 200 },
        ),
      );

      const spec = makeSpec({ site: { name: "Acme", type: "ecommerce", industry: "retail", audience: [] } });
      const results = await recommendThemes(spec);

      const live = results.find((r) => r.theme.slug === "brand-new-theme");
      expect(live).toBeDefined();
      expect(live!.source).toBe("wordpress.org");
      expect(live!.theme.category).toContain("ecommerce");
      expect(live!.theme.description).toBe("A shiny new theme."); // HTML stripped
      expect(results.filter((r) => r.theme.slug === "astra")).toHaveLength(1); // not duplicated

      expect(isAllowedTheme("brand-new-theme")).toBe(true); // THM-04 feeds SEC-06's allowlist
    });
  });

  describe("THM-05: buildDesignVariants", () => {
    it("returns exactly three named variants (bold/minimal/classic) with distinct design-system bundles", () => {
      const spec = makeSpec({ design: { ...emptySiteSpecification().design, primary_color: "#123456" } });
      const variants = buildDesignVariants(spec);

      expect(variants.map((v) => v.id)).toEqual(["bold", "minimal", "classic"]);

      const bold = variants.find((v) => v.id === "bold")!;
      expect(bold.mode).toBe("dark");
      expect(bold.heading_font).toBe("Poppins");
      expect(bold.body_font).toBe("Inter");
      expect(bold.radius).toBe("pill");
      expect(bold.preset).toBe("bold");
      // primary_color is unset in the palette exclusion, so the first accent wins.
      expect(bold.primary_color).toBe("#3651D4");

      const minimal = variants.find((v) => v.id === "minimal")!;
      expect(minimal.mode).toBe("light");
      expect(minimal.primary_color).toBe("#1B1D29");
      expect(minimal.heading_font).toBe("Inter");
      expect(minimal.body_font).toBe("Inter");
      expect(minimal.radius).toBe("soft");
      expect(minimal.preset).toBe("minimal");

      const classic = variants.find((v) => v.id === "classic")!;
      expect(classic.mode).toBe("light");
      expect(classic.heading_font).toBe("Playfair Display");
      expect(classic.body_font).toBe("Georgia");
      expect(classic.radius).toBe("sharp");
      expect(classic.preset).toBe("editorial");
      expect(classic.primary_color).toBe("#1E8E5A"); // second accent, since #123456 wasn't excluded from the palette

      // Every variant gets its own derived secondary color, not a copy of the primary.
      for (const v of variants) {
        expect(v.secondary_color).toMatch(/^#[0-9A-F]{6}$/);
        expect(v.secondary_color).not.toBe(v.primary_color);
      }
    });

    it("excludes the spec's own primary color from the accent palette so a variant never repeats it", () => {
      // #3651D4 is ACCENT_PALETTE[0] -- when it's the spec's own primary, "bold"
      // must skip it and use the next accent instead of picking the same color.
      const spec = makeSpec({ design: { ...emptySiteSpecification().design, primary_color: "#3651D4" } });
      const variants = buildDesignVariants(spec);
      const bold = variants.find((v) => v.id === "bold")!;
      const classic = variants.find((v) => v.id === "classic")!;
      expect(bold.primary_color).not.toBe("#3651D4");
      expect(bold.primary_color).toBe("#1E8E5A");
      expect(classic.primary_color).toBe("#C43D4B");
    });
  });

  describe("resolveThemeName", () => {
    it("prefers the name captured in the project's own theme recommendations", () => {
      const project = {
        spec: makeSpec(),
        themeRecommendations: [
          {
            theme: { ...THEME_CATALOG[0], slug: "some-live-slug", name: "Live Import Name" },
            score: 50,
            reasons: [],
          },
        ],
      };
      project.spec.theme.selected = "some-live-slug";
      expect(resolveThemeName(project as any)).toBe("Live Import Name");
    });

    it("falls back to the curated catalog name when there's no recommendation match", () => {
      const project = { spec: makeSpec(), themeRecommendations: [] };
      project.spec.theme.selected = "astra";
      expect(resolveThemeName(project as any)).toBe("Astra");
    });

    it("falls back to the bare slug when nothing else matches, and to 'theme' when nothing is selected", () => {
      const project = { spec: makeSpec(), themeRecommendations: [] };
      project.spec.theme.selected = "totally-unknown-slug";
      expect(resolveThemeName(project as any)).toBe("totally-unknown-slug");

      project.spec.theme.selected = null;
      expect(resolveThemeName(project as any)).toBe("theme");
    });
  });

  describe("isAllowedTheme (SEC-06 allowlist)", () => {
    it("allows every curated catalog slug and rejects an arbitrary/unknown one", () => {
      for (const t of THEME_CATALOG) {
        expect(isAllowedTheme(t.slug)).toBe(true);
      }
      expect(isAllowedTheme("../../etc/passwd")).toBe(false);
      expect(isAllowedTheme("some-random-slug-nobody-discovered")).toBe(false);
    });
  });
});
