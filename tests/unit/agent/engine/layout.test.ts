import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emptySiteSpecification } from "@ai-wp/shared";
import type { SiteSpecification } from "@ai-wp/shared";

vi.mock("../../../../apps/agent/src/llm/client.js", () => ({
  aiAvailable: vi.fn(),
  completeText: vi.fn(),
}));

import { aiAvailable, completeText } from "../../../../apps/agent/src/llm/client.js";
import {
  eligibleBonusSections,
  heuristicLayoutPlan,
  bonusContentKeys,
  planPageLayout,
} from "../../../../apps/agent/src/engine/layout.js";

function makeSpec(overrides: Partial<SiteSpecification> = {}): SiteSpecification {
  const base = emptySiteSpecification("Acme");
  return { ...base, ...overrides, site: { ...base.site, ...(overrides.site ?? {}) } };
}

describe("engine/layout.ts (GEN-11)", () => {
  beforeEach(() => {
    vi.mocked(aiAvailable).mockReset().mockReturnValue(false);
    vi.mocked(completeText).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  describe("eligibleBonusSections", () => {
    it("returns the curated eligible list for a known page slug", () => {
      expect(eligibleBonusSections("home")).toEqual(["stats", "testimonials", "faq", "cta"]);
      expect(eligibleBonusSections("case-studies")).toEqual(["features", "stats", "testimonials", "cta"]);
    });

    it("returns an empty list for a page slug with no bonus sections defined (e.g. contact)", () => {
      expect(eligibleBonusSections("contact")).toEqual([]);
      expect(eligibleBonusSections("totally-unknown-page")).toEqual([]);
    });
  });

  describe("heuristicLayoutPlan", () => {
    it("returns no bonus sections for a page with nothing eligible", () => {
      expect(heuristicLayoutPlan("contact", makeSpec())).toEqual({ bonus: [] });
    });

    it("home: adds a stats band only when the spec has at least one feature, always adds a closing cta", () => {
      const withFeatures = makeSpec({ features: ["ecommerce"] });
      const withoutFeatures = makeSpec({ features: [] });

      expect(heuristicLayoutPlan("home", withFeatures).bonus).toEqual(["stats", "cta"]);
      expect(heuristicLayoutPlan("home", withoutFeatures).bonus).toEqual(["cta"]);
    });

    it("non-home eligible pages get just a closing cta, regardless of features", () => {
      const spec = makeSpec({ features: ["ecommerce", "blog"] });
      expect(heuristicLayoutPlan("about", spec).bonus).toEqual(["cta"]);
      expect(heuristicLayoutPlan("services", spec).bonus).toEqual(["cta"]);
      expect(heuristicLayoutPlan("programs", spec).bonus).toEqual(["cta"]);
      expect(heuristicLayoutPlan("members", spec).bonus).toEqual(["cta"]);
    });

    it("GEN-11: the heuristic plan is not identical across every page type for the same spec", () => {
      const spec = makeSpec({ features: ["ecommerce"] });
      const home = heuristicLayoutPlan("home", spec);
      const about = heuristicLayoutPlan("about", spec);
      const contact = heuristicLayoutPlan("contact", spec);

      expect(home.bonus).not.toEqual(about.bonus); // home gets "stats" too, about doesn't
      expect(about.bonus).not.toEqual(contact.bonus); // about gets "cta", contact (ineligible) gets nothing
    });
  });

  describe("bonusContentKeys", () => {
    it("maps testimonials/faq bonus sections to their content-generator keys, and ignores sections with no extra content", () => {
      expect(bonusContentKeys(["testimonials", "faq", "cta", "stats"])).toEqual(["testimonials", "faqs"]);
      expect(bonusContentKeys(["cta"])).toEqual([]);
      expect(bonusContentKeys([])).toEqual([]);
    });
  });

  describe("planPageLayout: heuristic path (no AI provider)", () => {
    it("returns the heuristic plan and never calls completeText", async () => {
      vi.mocked(aiAvailable).mockReturnValue(false);
      const spec = makeSpec({ features: ["ecommerce"] });
      const plan = await planPageLayout("home", spec);
      expect(plan).toEqual(heuristicLayoutPlan("home", spec));
      expect(completeText).not.toHaveBeenCalled();
    });

    it("short-circuits for a page with no eligible sections without even checking aiAvailable", async () => {
      const plan = await planPageLayout("contact", makeSpec());
      expect(plan).toEqual({ bonus: [] });
      expect(aiAvailable).not.toHaveBeenCalled();
      expect(completeText).not.toHaveBeenCalled();
    });
  });

  describe("planPageLayout: AI-informed path", () => {
    beforeEach(() => vi.mocked(aiAvailable).mockReturnValue(true));

    it("uses the AI's chosen bonus sections, in the order given, when they're all eligible", async () => {
      vi.mocked(completeText).mockResolvedValue('{"bonus": ["testimonials", "faq"]}');
      const plan = await planPageLayout("about", makeSpec());
      expect(plan.bonus).toEqual(["testimonials", "faq"]);
    });

    it("filters out any section the AI names that isn't eligible for this specific page", async () => {
      // "features" is eligible for "about" but NOT for "home" (home's own core content already covers it) --
      // and "cta" (eligible everywhere) should still pass through.
      vi.mocked(completeText).mockResolvedValue('{"bonus": ["features", "cta"]}');
      const plan = await planPageLayout("home", makeSpec());
      expect(plan.bonus).toEqual(["cta"]);
    });

    it("dedupes repeated sections and drops names outside the fixed vocabulary entirely, without throwing", async () => {
      vi.mocked(completeText).mockResolvedValue('{"bonus": ["cta", "cta", "a-hallucinated-section", "FAQ"]}');
      const plan = await planPageLayout("about", makeSpec());
      // "FAQ" lowercases to a real vocabulary entry and is kept; the hallucinated one and the duplicate are dropped.
      expect(plan.bonus).toEqual(["cta", "faq"]);
    });

    it("GEN-11: two different page types can get different AI-planned layouts for the same spec", async () => {
      vi.mocked(completeText)
        .mockResolvedValueOnce('{"bonus": ["testimonials", "cta"]}') // for "about"
        .mockResolvedValueOnce('{"bonus": ["faq"]}'); // for "services"
      const spec = makeSpec();

      const about = await planPageLayout("about", spec);
      const services = await planPageLayout("services", spec);

      expect(about.bonus).toEqual(["testimonials", "cta"]);
      expect(services.bonus).toEqual(["faq"]);
      expect(about.bonus).not.toEqual(services.bonus);
    });

    it("falls back to the heuristic plan when completeText returns null", async () => {
      vi.mocked(completeText).mockResolvedValue(null);
      const spec = makeSpec({ features: ["blog"] });
      const plan = await planPageLayout("home", spec);
      expect(plan).toEqual(heuristicLayoutPlan("home", spec));
    });

    it("falls back to the heuristic plan when completeText returns unparseable JSON", async () => {
      vi.mocked(completeText).mockResolvedValue("sure, let's add some testimonials!");
      const spec = makeSpec();
      const plan = await planPageLayout("about", spec);
      expect(plan).toEqual(heuristicLayoutPlan("about", spec));
    });

    it("falls back to the heuristic plan when the JSON is well-formed but 'bonus' isn't an array", async () => {
      vi.mocked(completeText).mockResolvedValue('{"bonus": "testimonials"}');
      const spec = makeSpec();
      const plan = await planPageLayout("about", spec);
      expect(plan).toEqual(heuristicLayoutPlan("about", spec));
    });

    it("accepts an empty bonus list as a deliberate 'none of these fit' answer, not a fallback trigger", async () => {
      vi.mocked(completeText).mockResolvedValue('{"bonus": []}');
      const spec = makeSpec({ features: ["ecommerce"] }); // heuristic would otherwise add "stats"+"cta" for home
      const plan = await planPageLayout("home", spec);
      expect(plan.bonus).toEqual([]);
    });
  });
});
