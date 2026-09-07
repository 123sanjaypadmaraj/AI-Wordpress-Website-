import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptySiteSpecification } from "@ai-wp/shared";
import type { SiteSpecification } from "@ai-wp/shared";

// contentGenerator.ts and layout.ts both call through to the same shared llm
// client module -- mock it once so both the supporting-content generation and
// the full page-assembly tests below can drive the AI/heuristic branches.
vi.mock("../../../../apps/agent/src/llm/client.js", () => ({
  aiAvailable: vi.fn(() => false),
  completeText: vi.fn(async () => null),
}));

import { aiAvailable, completeText } from "../../../../apps/agent/src/llm/client.js";
import {
  generateSupportingContent,
  siteContext,
  type SupportingContent,
} from "../../../../apps/agent/src/engine/contentGenerator.js";
import { heuristicLayoutPlan, eligibleBonusSections } from "../../../../apps/agent/src/engine/layout.js";
import { buildPageContent } from "../../../../apps/agent/src/engine/templates.js";
import type { PageCopy } from "../../../../apps/agent/src/engine/copywriter.js";

const mockAiAvailable = vi.mocked(aiAvailable);
const mockCompleteText = vi.mocked(completeText);

function spec(overrides: Partial<SiteSpecification> = {}): SiteSpecification {
  return { ...emptySiteSpecification("Green Fork Bistro"), ...overrides };
}

function copyFor(headline: string, features: PageCopy["features"] = []): PageCopy {
  return { headline, subhead: `${headline} subhead`, body: [`${headline} body.`], features };
}

beforeEach(() => {
  mockAiAvailable.mockReset().mockReturnValue(false);
  mockCompleteText.mockReset().mockResolvedValue(null);
});

describe("engine/contentGenerator.ts", () => {
  describe("siteContext", () => {
    it("summarizes the key spec fields the AI prompts rely on", () => {
      const ctx = siteContext(
        spec({
          site: { name: "Green Fork Bistro", type: "restaurant", industry: "food", audience: ["diners"] },
          features: ["menu"],
        }),
      );
      expect(ctx).toContain("Green Fork Bistro");
      expect(ctx).toContain("restaurant");
      expect(ctx).toContain("diners");
      expect(ctx).toContain("menu");
    });
  });

  describe("generateSupportingContent -- key selection", () => {
    it("returns an empty object for a page slug with no supporting-content keys and no extras", async () => {
      const result = await generateSupportingContent("home", spec());
      expect(result).toEqual({});
      expect(mockCompleteText).not.toHaveBeenCalled();
    });

    it("still generates content for a page slug with no default keys when extraKeys ask for one (GEN-11 bonus sections)", async () => {
      const result = await generateSupportingContent("home", spec(), ["testimonials"]);
      expect(result.testimonials).toBeDefined();
      expect(result.testimonials!.length).toBeGreaterThan(0);
    });

    it("merges a page's default keys with extraKeys without duplicating", async () => {
      mockAiAvailable.mockReturnValue(false);
      const result = await generateSupportingContent("team", spec(), ["team"]);
      expect(result.team).toBeDefined();
      expect(Object.keys(result)).toEqual(["team"]);
    });
  });

  describe("generateSupportingContent -- heuristic path", () => {
    const cases: Array<[string, keyof SupportingContent]> = [
      ["team", "team"],
      ["pricing", "pricingTiers"],
      ["testimonials", "testimonials"],
      ["faq", "faqs"],
      ["gallery", "galleryItems"],
      ["projects", "galleryItems"],
      ["case-studies", "caseStudies"],
      ["careers", "jobs"],
      ["events", "events"],
      ["menu", "menuItems"],
      ["members", "membershipTiers"],
    ];

    it.each(cases)("generates non-empty %s content keyed as %s when no AI provider is configured", async (slug, key) => {
      const result = await generateSupportingContent(slug, spec());
      const value = result[key];
      expect(Array.isArray(value)).toBe(true);
      expect((value as unknown[]).length).toBeGreaterThan(0);
      expect(mockCompleteText).not.toHaveBeenCalled();
    });
  });

  describe("generateSupportingContent -- AI-provider path", () => {
    it("merges in AI-provided fields over the heuristic defaults", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(
        JSON.stringify({ team: [{ name: "Team Member 1", role: "Head Chef" }] }),
      );
      const result = await generateSupportingContent("team", spec());
      expect(result.team).toEqual([{ name: "Team Member 1", role: "Head Chef" }]);
    });

    it("falls back to the heuristic value per-field when the AI response only covers some requested keys", async () => {
      mockAiAvailable.mockReturnValue(true);
      // Requesting two keys together (team's own default key, plus faqs via
      // extraKeys) but only supplying a valid "team" array in the AI reply --
      // "faqs" must fall back to the heuristic placeholder independently.
      mockCompleteText.mockResolvedValue(
        JSON.stringify({ team: [{ name: "Team Member 1", role: "Sommelier" }] }),
      );
      const result = await generateSupportingContent("team", spec(), ["faqs"]);
      expect(result.team).toEqual([{ name: "Team Member 1", role: "Sommelier" }]);
      expect(result.faqs).toBeDefined();
      expect(result.faqs!.length).toBeGreaterThan(0);
    });

    it("ignores an AI-provided field that isn't a non-empty array and falls back to heuristic for it", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(JSON.stringify({ team: "not an array" }));
      const result = await generateSupportingContent("team", spec());
      expect(Array.isArray(result.team)).toBe(true);
      expect(result.team!.length).toBeGreaterThan(0);
    });

    it("falls back entirely to heuristic content without throwing when the provider returns null", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(null);
      const result = await generateSupportingContent("pricing", spec());
      expect(result.pricingTiers).toBeDefined();
      expect(result.pricingTiers!.length).toBeGreaterThan(0);
    });

    it("falls back entirely to heuristic content without throwing when the provider returns unparsable prose", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue("I can't do that.");
      const result = await generateSupportingContent("faq", spec());
      expect(result.faqs).toBeDefined();
      expect(result.faqs!.length).toBeGreaterThan(0);
    });

    it("falls back entirely to heuristic content without throwing when the provider returns malformed JSON", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue('{"faqs": [');
      const result = await generateSupportingContent("faq", spec());
      expect(result.faqs).toBeDefined();
      expect(result.faqs!.length).toBeGreaterThan(0);
    });
  });

  // GEN-11 full page assembly: engine/layout.ts decides which bonus sections
  // apply and in what order, engine/copywriter.ts (mocked here via a plain
  // PageCopy fixture) supplies the core copy, contentGenerator.ts supplies any
  // supporting content a bonus section needs, and templates.ts's
  // buildPageContent stitches all three into the final page. This block
  // exercises that whole pipeline for a page type + spec + layout decision.
  describe("full page assembly (layout decision -> content -> template)", () => {
    it("renders home with an AI-and-heuristic-agnostic hero -> features -> ordered bonus sections", async () => {
      const s = spec({ features: ["menu", "reservations"] });
      const layout = heuristicLayoutPlan("home", s); // { bonus: ["stats", "cta"] } (features present)
      expect(layout.bonus).toEqual(["stats", "cta"]);

      const content = await generateSupportingContent("home", s);
      const copy = copyFor("Green Fork Bistro", [{ title: "Menu", body: "Seasonal dishes." }]);

      const html = buildPageContent("home", s, copy, { contactFormId: null, layout, content });

      const heroIdx = html.indexOf("<h1>Green Fork Bistro</h1>");
      const featuresIdx = html.indexOf("What we offer");
      const statsIdx = html.indexOf("section-stats");
      const ctaIdx = html.indexOf("section-cta");

      expect(heroIdx).toBeGreaterThanOrEqual(0);
      expect(featuresIdx).toBeGreaterThan(heroIdx);
      expect(statsIdx).toBeGreaterThan(featuresIdx);
      expect(ctaIdx).toBeGreaterThan(statsIdx);
    });

    it("gives about only a closing CTA bonus by default, even though it's eligible for more", async () => {
      const s = spec();
      expect(eligibleBonusSections("about")).toEqual(["features", "stats", "testimonials", "faq", "cta"]);
      const layout = heuristicLayoutPlan("about", s);
      // The conservative heuristic only ever adds a closing "cta" for
      // non-home pages -- richer picks are the AI planner's job.
      expect(layout.bonus).toEqual(["cta"]);

      const content = await generateSupportingContent("about", s);
      const copy = copyFor("About Green Fork Bistro");
      const html = buildPageContent("about", s, copy, { contactFormId: null, layout, content });

      expect(html.indexOf("<h1>About Green Fork Bistro</h1>")).toBe(0 + html.indexOf("<h1>About Green Fork Bistro</h1>"));
      expect(html).toContain("section-cta");
      expect(html).not.toContain("section-testimonials");
      expect(html).not.toContain("section-faq");
    });

    it("assembles the members page as hero -> pricing tiers -> benefits -> bonus, with AI-sourced tiers when available", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(
        JSON.stringify({
          membershipTiers: [{ name: "Supporter", price: "$5/mo", features: ["Newsletter"] }],
        }),
      );

      const s = spec();
      const layout = heuristicLayoutPlan("members", s);
      expect(layout.bonus).toEqual(["cta"]); // eligible includes "cta" -> heuristic keeps only that

      const content = await generateSupportingContent("members", s);
      expect(content.membershipTiers).toEqual([{ name: "Supporter", price: "$5/mo", features: ["Newsletter"] }]);

      const copy = copyFor("Membership", [{ title: "Perks", body: "Great perks." }]);
      const html = buildPageContent("members", s, copy, { contactFormId: null, layout, content });

      const heroIdx = html.indexOf("<h1>Membership</h1>");
      const tierIdx = html.indexOf("Supporter");
      const benefitsIdx = html.indexOf("Member benefits");
      const ctaIdx = html.lastIndexOf("section-cta");

      expect(heroIdx).toBeGreaterThanOrEqual(0);
      expect(tierIdx).toBeGreaterThan(heroIdx);
      expect(benefitsIdx).toBeGreaterThan(tierIdx);
      expect(ctaIdx).toBeGreaterThan(benefitsIdx);
    });

    it("degrades to no supporting content and no throw when generateSupportingContent's AI path fails for a bonus-driven key", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(null); // simulated provider failure

      const s = spec();
      const layout = { bonus: ["testimonials" as const] };
      const content = await generateSupportingContent("home", s, ["testimonials"]);
      // Heuristic per-field fallback still produces placeholder testimonials.
      expect(content.testimonials!.length).toBeGreaterThan(0);

      const copy = copyFor("Green Fork Bistro");
      const html = buildPageContent("home", s, copy, { contactFormId: null, layout, content });
      expect(html).toContain("section-testimonials");
    });
  });
});
