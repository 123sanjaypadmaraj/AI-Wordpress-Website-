import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptySiteSpecification } from "@ai-wp/shared";
import type { SiteSpecification } from "@ai-wp/shared";

// engine/copywriter.ts imports { aiAvailable, completeText } from "../llm/client.js"
// (apps/agent/src/llm/client.ts). Mocking that module lets us exercise both the
// heuristic and AI-provider branches without a real API key -- see
// apps/agent/.env.example, which documents this as the fallback contract.
vi.mock("../../../../apps/agent/src/llm/client.js", () => ({
  aiAvailable: vi.fn(() => false),
  completeText: vi.fn(async () => null),
}));

import { aiAvailable, completeText } from "../../../../apps/agent/src/llm/client.js";
import { generateCopy, rewritePageContent } from "../../../../apps/agent/src/engine/copywriter.js";

const mockAiAvailable = vi.mocked(aiAvailable);
const mockCompleteText = vi.mocked(completeText);

function spec(overrides: Partial<SiteSpecification> = {}): SiteSpecification {
  return { ...emptySiteSpecification("Acme Studio"), ...overrides };
}

beforeEach(() => {
  mockAiAvailable.mockReset().mockReturnValue(false);
  mockCompleteText.mockReset().mockResolvedValue(null);
});

const ALL_PAGE_SLUGS = [
  "home",
  "about",
  "contact",
  "faq",
  "careers",
  "blog",
  "shop",
  "donate",
  "events",
  "menu",
  "reservations",
  "booking",
  "gallery",
  "projects",
  "case-studies",
  "services",
  "programs",
  "members",
  "some-unrecognized-slug",
];

describe("engine/copywriter.ts", () => {
  describe("generateCopy -- heuristic path (no AI provider configured)", () => {
    it.each(ALL_PAGE_SLUGS)("produces non-empty, plausible copy for %s", async (slug) => {
      const s = spec({ features: ["ecommerce", "blog"] });
      const copy = await generateCopy(slug, s);
      expect(copy.headline.trim().length).toBeGreaterThan(0);
      expect(copy.subhead.trim().length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.body.every((p) => p.trim().length > 0)).toBe(true);
      // capped at 3 (heuristicCopy does `.slice(0, 3)`); this spec has 2 features.
      expect(copy.features.length).toBe(2);
      expect(copy.features.every((f) => f.title && f.body)).toBe(true);
      expect(mockCompleteText).not.toHaveBeenCalled();
    });

    it("falls back to generic feature copy when the spec lists no features", () => {
      return generateCopy("home", spec({ features: [] })).then((copy) => {
        expect(copy.features).toHaveLength(3);
        expect(copy.features.map((f) => f.title)).toEqual(["Quality", "Reliability", "Support"]);
      });
    });

    it("uses the site's own features (title-cased) when present", async () => {
      const copy = await generateCopy("home", spec({ features: ["seo-optimization"] }));
      expect(copy.features[0].title).toBe("Seo optimization");
    });

    it("titleizes an unrecognized page slug into a sensible headline", async () => {
      const copy = await generateCopy("weird-custom-page", spec());
      expect(copy.headline).toBe("Weird custom page");
    });

    it("includes a cta/ctaHeadline only for page types that use one heuristically", async () => {
      const home = await generateCopy("home", spec());
      expect(home.cta).toBe("Get started");
      expect(home.ctaHeadline).toBeTruthy();

      const about = await generateCopy("about", spec());
      expect(about.cta).toBeUndefined();
    });
  });

  describe("generateCopy -- AI-provider path", () => {
    it("uses the AI response when the provider returns valid, complete JSON", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(
        JSON.stringify({
          headline: "AI Headline",
          subhead: "AI Subhead",
          body: ["AI paragraph one."],
          features: [
            { title: "AI Feature A", body: "a" },
            { title: "AI Feature B", body: "b" },
            { title: "AI Feature C", body: "c" },
          ],
          cta: "AI CTA",
          ctaHeadline: "AI CTA Headline",
        }),
      );

      const copy = await generateCopy("home", spec());
      expect(copy.headline).toBe("AI Headline");
      expect(copy.subhead).toBe("AI Subhead");
      expect(copy.body).toEqual(["AI paragraph one."]);
      expect(copy.features.map((f) => f.title)).toEqual(["AI Feature A", "AI Feature B", "AI Feature C"]);
      expect(copy.cta).toBe("AI CTA");
    });

    it("falls back to heuristic features when the AI reply omits them", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(JSON.stringify({ headline: "AI H", subhead: "AI S" }));

      const s = spec({ features: ["blog"] });
      const copy = await generateCopy("home", s);
      expect(copy.headline).toBe("AI H");
      // body defaults to [subhead] when the AI reply omits it
      expect(copy.body).toEqual(["AI S"]);
      expect(copy.features[0].title).toBe("Blog");
    });

    it("falls back to heuristic copy without throwing when the provider returns null (e.g. auth/network failure)", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(null);

      const s = spec();
      const copy = await generateCopy("home", s);
      expect(copy.headline).toBe(s.site.name);
    });

    it("falls back to heuristic copy without throwing when the provider returns unparsable prose (no JSON object)", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue("Sorry, I can't help with that right now.");

      const s = spec();
      const copy = await generateCopy("about", s);
      expect(copy.headline).toBe(`About ${s.site.name}`);
    });

    it("falls back to heuristic copy without throwing when the provider returns malformed JSON", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue('{"headline": "Oops", "subhead": ');

      const s = spec();
      const copy = await generateCopy("contact", s);
      expect(copy.headline).toBe("Get in touch");
    });

    it("falls back to heuristic copy without throwing when the JSON is missing a required field", async () => {
      mockAiAvailable.mockReturnValue(true);
      // Valid JSON, but missing "subhead" -- aiCopy() treats this as a failed
      // generation rather than rendering an incomplete page.
      mockCompleteText.mockResolvedValue(JSON.stringify({ headline: "Only a headline" }));

      const s = spec();
      const copy = await generateCopy("home", s);
      expect(copy.headline).toBe(s.site.name);
    });
  });

  describe("rewritePageContent", () => {
    const params = {
      siteName: "Acme",
      pageTitle: "About",
      currentContent: "<!-- wp:paragraph --><p>Old copy.</p><!-- /wp:paragraph -->",
      instruction: "Make it shorter",
    };

    it("returns null immediately when no AI provider is configured (no offline heuristic exists for free-form edits)", async () => {
      mockAiAvailable.mockReturnValue(false);
      const result = await rewritePageContent(params);
      expect(result).toBeNull();
      expect(mockCompleteText).not.toHaveBeenCalled();
    });

    it("returns the rewritten title/content when the AI reply is valid JSON", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(JSON.stringify({ title: "About Us", content: "<p>New copy.</p>" }));
      const result = await rewritePageContent(params);
      expect(result).toEqual({ title: "About Us", content: "<p>New copy.</p>" });
    });

    it("keeps the original title when the AI reply omits it", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(JSON.stringify({ content: "<p>New copy.</p>" }));
      const result = await rewritePageContent(params);
      expect(result?.title).toBe(params.pageTitle);
    });

    it("returns null without throwing when the AI reply has no content field", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(JSON.stringify({ title: "About Us" }));
      const result = await rewritePageContent(params);
      expect(result).toBeNull();
    });

    it("returns null without throwing when the provider fails (returns null)", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue(null);
      const result = await rewritePageContent(params);
      expect(result).toBeNull();
    });

    it("returns null without throwing when the AI reply is malformed JSON", async () => {
      mockAiAvailable.mockReturnValue(true);
      mockCompleteText.mockResolvedValue("{not json");
      const result = await rewritePageContent(params);
      expect(result).toBeNull();
    });
  });
});
