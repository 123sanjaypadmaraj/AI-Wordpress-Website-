import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EMPTY_SLOTS } from "@ai-wp/shared";
import type { RequirementSlots } from "@ai-wp/shared";

vi.mock("../../../../apps/agent/src/llm/client.js", () => ({
  aiAvailable: vi.fn(),
  completeText: vi.fn(),
}));

// Mocked so these tests never hit the real wordpress.org plugin directory --
// live discovery itself is task 03's engine/skills.ts responsibility.
vi.mock("../../../../apps/agent/src/engine/skills.js", () => ({
  skillDiscoveryEnabled: vi.fn(() => false),
  extractSkillMention: vi.fn(() => null),
  discoverSkillPlugin: vi.fn(async () => null),
}));

import { aiAvailable, completeText } from "../../../../apps/agent/src/llm/client.js";
import { skillDiscoveryEnabled, discoverSkillPlugin } from "../../../../apps/agent/src/engine/skills.js";
import {
  detectFromKeywords,
  FEATURE_KEYWORDS,
  runRequirementTurn,
  buildSiteSpecification,
} from "../../../../apps/agent/src/engine/requirements.js";

function slots(overrides: Partial<RequirementSlots> = {}): RequirementSlots {
  return { ...EMPTY_SLOTS, ...overrides };
}

describe("engine/requirements.ts", () => {
  beforeEach(() => {
    vi.mocked(aiAvailable).mockReset().mockReturnValue(false);
    vi.mocked(completeText).mockReset();
    vi.mocked(skillDiscoveryEnabled).mockReset().mockReturnValue(false);
    vi.mocked(discoverSkillPlugin).mockReset().mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  describe("detectFromKeywords word-boundary matching (regression)", () => {
    it("does not false-positive 'blog' on the word 'newsletter' containing 'news'", () => {
      // FEATURE_KEYWORDS.blog includes "news" as a keyword; a naive substring
      // check would wrongly fire on "newsletter". \b-bounded matching must not.
      expect(detectFromKeywords("please add a newsletter signup", FEATURE_KEYWORDS)).not.toContain("blog");
      expect(detectFromKeywords("please add a newsletter signup", FEATURE_KEYWORDS)).toContain("newsletter");
    });

    it("still matches 'blog' as its own word", () => {
      expect(detectFromKeywords("I want a blog too", FEATURE_KEYWORDS)).toContain("blog");
    });
  });

  describe("heuristic extraction across realistic chat inputs (no AI provider)", () => {
    it("e-commerce site: detects type, features, and a color from one free-form message", async () => {
      const result = await runRequirementTurn(
        "I want to build an online store to sell handmade candles, with a green color scheme",
        EMPTY_SLOTS,
      );
      expect(result.slots.websiteType).toBe("ecommerce");
      expect(result.slots.features).toContain("ecommerce");
      expect(result.slots.colorPreference).toBe("green");
      expect(result.specReady).toBe(false);
      // websiteType+colorPreference are filled; audience is the next thing genuinely missing.
      expect(result.reply.toLowerCase()).toContain("audience");
    });

    it("e-commerce site: the features follow-up is tailored with ecommerce-relevant suggestions", async () => {
      // Deliberately avoids "store"/"shop" so the ecommerce *feature* keyword doesn't
      // also fire on turn one -- this test is about the features question itself.
      const afterType = await runRequirementTurn("I run an e-commerce business", EMPTY_SLOTS);
      expect(afterType.slots.features).toBeNull();
      const afterAudience = await runRequirementTurn("shoppers looking for gifts", afterType.slots);
      expect(afterAudience.reply).toContain("online stores");
      expect(afterAudience.choices?.map((c) => c.value)).toEqual(
        expect.arrayContaining(["ecommerce", "newsletter", "contact-form"]),
      );
    });

    it("portfolio site: detects the portfolio type from a photographer's description", async () => {
      const result = await runRequirementTurn(
        "I'm a photographer and want a portfolio site to showcase my work",
        EMPTY_SLOTS,
      );
      expect(result.slots.websiteType).toBe("portfolio");
      expect(result.slots.features).toContain("project-showcase");
    });

    it("portfolio site: the features follow-up suggests project-showcase-relevant options", async () => {
      // "photographer" triggers the portfolio *type* keyword without also tripping
      // the project-showcase *feature* keyword ("portfolio"/"showcase"/etc).
      const afterType = await runRequirementTurn("I'm a photographer looking for a website", EMPTY_SLOTS);
      expect(afterType.slots.websiteType).toBe("portfolio");
      expect(afterType.slots.features).toBeNull();
      const afterAudience = await runRequirementTurn("potential clients", afterType.slots);
      expect(afterAudience.reply).toContain("portfolios");
      expect(afterAudience.choices?.map((c) => c.value)).toEqual(
        expect.arrayContaining(["project-showcase", "contact-form"]),
      );
    });

    it("restaurant site: detects type and a booking-shaped feature", async () => {
      const result = await runRequirementTurn(
        "We run a small cafe and need a site with a menu and online reservations",
        EMPTY_SLOTS,
      );
      expect(result.slots.websiteType).toBe("restaurant");
      expect(result.slots.features).toContain("booking");
    });

    it("restaurant site: extra-pages follow-up suggests a gallery, and the base page plan includes menu/reservations", async () => {
      // "reservations" (plural) both detects the "restaurant" type and, post-fix, the
      // "booking" feature in one turn -- so audience is the only other slot needed
      // before the pages question comes up.
      let turn = await runRequirementTurn("small restaurant, need a menu and reservations", EMPTY_SLOTS);
      expect(turn.slots.websiteType).toBe("restaurant");
      expect(turn.slots.features).toEqual(["booking"]);
      turn = await runRequirementTurn("local diners", turn.slots);
      expect(turn.reply).toMatch(/menu, reservations/);
      expect(turn.choices?.map((c) => c.value)).toEqual(expect.arrayContaining(["gallery", "faq"]));

      // And answering "none of these" here (a very natural reuse of the previous
      // question's own answer) must clear pages to [], not stash a literal "none" page.
      const declined = await runRequirementTurn("none of these", turn.slots);
      expect(declined.slots.pages).toEqual([]);
    });

    it("SaaS landing page (startup): detects type and a pricing-shaped extra page", async () => {
      let turn = await runRequirementTurn("We're launching our SaaS product and need a landing page", EMPTY_SLOTS);
      expect(turn.slots.websiteType).toBe("startup");
      turn = await runRequirementTurn("developers and IT teams", turn.slots);
      expect(turn.reply.toLowerCase()).not.toContain("undefined");
      const featuresChoiceValues = turn.choices?.map((c) => c.value) ?? [];
      expect(featuresChoiceValues).toEqual(expect.arrayContaining(["newsletter", "contact-form", "blog"]));
    });

    it("explicit 'none of these' / 'looks good' answers are recorded as empty arrays, not left unanswered", async () => {
      const withFeatures = slots({ websiteType: "startup", audience: ["general public"] });
      const afterFeatures = await runRequirementTurn("none of these", withFeatures);
      expect(afterFeatures.slots.features).toEqual([]);

      const afterPages = await runRequirementTurn("looks good", { ...afterFeatures.slots });
      expect(afterPages.slots.pages).toEqual([]);
    });

    it("a niche answer with no keyword match (direct-answer fallback) still fills the pending slot instead of re-asking forever", async () => {
      const pendingAudience = slots({ websiteType: "organization" });
      const result = await runRequirementTurn("mostly patients", pendingAudience);
      expect(result.slots.audience).toEqual(["mostly patients"]);
    });

    it("a compound direct-answer audience with no keyword hit is split on 'and'/commas into separate entries", async () => {
      const pendingAudience = slots({ websiteType: "organization" });
      const result = await runRequirementTurn("teachers and school staff", pendingAudience);
      expect(result.slots.audience).toEqual(["teachers", "school staff"]);
    });

    it("the 'student' audience keyword short-circuits to a single canonical entry, even for a compound answer", async () => {
      // Documents a real (if minor) heuristic limitation: heuristicExtract's audience
      // keyword check fires on the word "student" and hardcodes ["students"], so it
      // never reaches the free-text splitter -- "parents" is silently dropped here.
      // The AI-provider path (see below) does a full extraction and doesn't have this gap.
      const pendingAudience = slots({ websiteType: "organization" });
      const result = await runRequirementTurn("students and parents", pendingAudience);
      expect(result.slots.audience).toEqual(["students"]);
    });

    it("the ecommerce-payment follow-up only appears when ecommerce is actually in play", async () => {
      const readyExceptPayment = slots({
        websiteType: "portfolio",
        audience: ["clients"],
        features: [],
        pages: [],
        visualStyle: "minimal",
      });
      const result = await runRequirementTurn("anything", readyExceptPayment);
      // Not an ecommerce site -- payment question must be skipped entirely.
      expect(result.reply.toLowerCase()).not.toContain("payment method");
    });

    it("reaches specReady once every applicable slot is filled", async () => {
      const almostReady = slots({
        websiteType: "portfolio",
        audience: ["clients"],
        features: [],
        pages: [],
        visualStyle: "minimal",
        integrations: [],
      });
      const result = await runRequirementTurn("anything", almostReady);
      expect(result.specReady).toBe(true);
      expect(result.reply).toContain("everything I need");
    });
  });

  describe("AI-provider path", () => {
    beforeEach(() => vi.mocked(aiAvailable).mockReturnValue(true));

    it("merges AI-extracted fields the heuristic pass didn't find, and surfaces the AI's ack as the reply prefix", async () => {
      vi.mocked(completeText)
        // aiExtract
        .mockResolvedValueOnce('{"websiteType": "ecommerce", "reply": "Got it, a boutique shop!"}')
        // aiTailorQuestion (still called since a slot remains missing)
        .mockResolvedValueOnce("Who are you hoping shops with you?");

      const result = await runRequirementTurn("I need a site for my boutique", EMPTY_SLOTS);

      expect(result.slots.websiteType).toBe("ecommerce"); // heuristic found nothing for "boutique"; AI did
      expect(result.reply).toBe("Got it, a boutique shop! Who are you hoping shops with you?");
      expect(result.specReady).toBe(false);
    });

    it("prefers the heuristic's own extraction over the AI's for a field both found", async () => {
      vi.mocked(completeText)
        .mockResolvedValueOnce('{"websiteType": "blog", "reply": "Noted."}')
        .mockResolvedValueOnce("What's the site called, and who reads it?");
      const result = await runRequirementTurn("I want an online store to sell shoes", EMPTY_SLOTS);
      expect(result.slots.websiteType).toBe("ecommerce"); // heuristic wins, AI's "blog" is discarded
    });

    it("unions AI-suggested features with heuristic-detected ones instead of replacing them", async () => {
      vi.mocked(completeText)
        .mockResolvedValueOnce('{"features": ["newsletter"]}')
        .mockResolvedValueOnce("Anything else you'd like on the site?");
      const withType = slots({ websiteType: "startup", audience: ["general public"] });
      const result = await runRequirementTurn("we also want a blog for updates", withType);
      expect(result.slots.features?.sort()).toEqual(["blog", "newsletter"].sort());
    });

    it("falls back to heuristic-only extraction, without throwing, when completeText returns null", async () => {
      vi.mocked(completeText).mockResolvedValue(null);
      const result = await runRequirementTurn("I want an online store", EMPTY_SLOTS);
      expect(result.slots.websiteType).toBe("ecommerce");
      // No AI ack was available, so the reply is just the (AI-tailored, but here also null->fallback) static question.
      expect(typeof result.reply).toBe("string");
      expect(result.reply.length).toBeGreaterThan(0);
    });

    it("falls back to heuristic-only extraction, without throwing, when completeText returns unparseable JSON", async () => {
      vi.mocked(completeText).mockResolvedValue("I think this is a store! Let's go with that.");
      const result = await runRequirementTurn("I want an online store", EMPTY_SLOTS);
      expect(result.slots.websiteType).toBe("ecommerce");
    });

    it("aiTailorQuestion falls back to the static question text when it returns nothing usable", async () => {
      vi.mocked(completeText)
        .mockResolvedValueOnce(null) // aiExtract: no extraction this turn
        .mockResolvedValueOnce("   "); // aiTailorQuestion: blank -> falls back
      // Neither heuristics nor the (mocked-null) AI extractor recognize "hello" as a
      // website type, so the direct-answer fallback takes it at face value for the
      // slot that was pending (websiteType) -- audience becomes the next missing slot.
      const result = await runRequirementTurn("hello", EMPTY_SLOTS);
      expect(result.slots.websiteType).toBe("hello");
      expect(result.reply).toBe("Who's the primary audience for the site?");
    });
  });

  describe("buildSiteSpecification", () => {
    it("assembles a full spec from filled slots, deriving base pages from the site type and adding extra pages/features", () => {
      const spec = buildSiteSpecification(
        "Gadget Shop",
        slots({
          websiteType: "ecommerce",
          audience: ["shoppers"],
          features: ["ecommerce", "newsletter"],
          pages: ["faq"],
          visualStyle: "bold",
          colorPreference: "green",
          ecommercePayment: "stripe",
          seo: true,
          accessibility: false,
          integrations: ["google-analytics"],
        }),
      );

      expect(spec.site.name).toBe("Gadget Shop");
      expect(spec.site.type).toBe("ecommerce");
      expect(spec.pages).toEqual(expect.arrayContaining(["home", "about", "contact", "shop", "product", "cart", "checkout", "faq"]));
      expect(spec.features).toEqual(["ecommerce", "newsletter"]);
      expect(spec.design.style).toBe("bold");
      expect(spec.design.primary_color).toBe("#1E8E5A"); // COLOR_MAP.green
      expect(spec.design.preset).toBe("bold"); // pickPresetHeuristic("bold", "ecommerce")
      expect(spec.ecommerce.payment).toBe("stripe");
      expect(spec.seo).toBe(true);
      expect(spec.accessibility).toBe(false);
      expect(spec.integrations).toEqual(["google-analytics"]);
    });

    it("defaults sensibly when slots are mostly unfilled", () => {
      const spec = buildSiteSpecification("Untitled", slots());
      expect(spec.site.type).toBe("business");
      expect(spec.pages).toEqual(expect.arrayContaining(["home", "about", "contact"]));
      expect(spec.features).toEqual([]);
      expect(spec.theme.selected).toBeNull();
      expect(spec.theme.use_child_theme).toBe(true);
    });

    it("filters a stray 'none' sentinel value out of features", () => {
      const spec = buildSiteSpecification("Acme", slots({ features: ["blog", "none"] }));
      expect(spec.features).toEqual(["blog"]);
    });

    it("switches to dark mode for a futuristic style, or an explicit dark color preference", () => {
      const futuristic = buildSiteSpecification("Acme", slots({ visualStyle: "futuristic" }));
      expect(futuristic.design.mode).toBe("dark");

      const darkPreference = buildSiteSpecification("Acme", slots({ colorPreference: "dark" }));
      expect(darkPreference.design.mode).toBe("dark");

      const lightDefault = buildSiteSpecification("Acme", slots({ visualStyle: "minimal" }));
      expect(lightDefault.design.mode).toBe("light");
    });
  });
});
