import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emptySiteSpecification } from "@ai-wp/shared";
import type { SiteSpecification } from "@ai-wp/shared";

vi.mock("../../../../apps/agent/src/llm/client.js", () => ({
  aiAvailable: vi.fn(),
  completeText: vi.fn(),
}));

// Mocked so these tests never hit the real wordpress.org plugin directory --
// live discovery itself is task 03's engine/skills.ts responsibility. Here we
// only need to control whether/what classifyEditIntent's skill path finds.
vi.mock("../../../../apps/agent/src/engine/skills.js", () => ({
  skillDiscoveryEnabled: vi.fn(() => false),
  extractSkillMention: vi.fn(() => null),
  discoverSkillPlugin: vi.fn(async () => null),
}));

import { aiAvailable, completeText } from "../../../../apps/agent/src/llm/client.js";
import { skillDiscoveryEnabled, extractSkillMention, discoverSkillPlugin } from "../../../../apps/agent/src/engine/skills.js";
import { classifyEditIntent } from "../../../../apps/agent/src/engine/editIntent.js";

function makeSpec(overrides: Partial<SiteSpecification> = {}): SiteSpecification {
  const base = emptySiteSpecification("Acme");
  return { ...base, ...overrides };
}

describe("engine/editIntent.ts (GEN-09)", () => {
  beforeEach(() => {
    vi.mocked(aiAvailable).mockReset().mockReturnValue(false);
    vi.mocked(completeText).mockReset();
    vi.mocked(skillDiscoveryEnabled).mockReset().mockReturnValue(false);
    vi.mocked(extractSkillMention).mockReset().mockReturnValue(null);
    vi.mocked(discoverSkillPlugin).mockReset().mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  describe("heuristic classification of realistic edit requests (no AI provider)", () => {
    it('"add a pricing page" -> add_page', async () => {
      const result = await classifyEditIntent("add a pricing page", makeSpec());
      expect(result).toEqual({ kind: "add_page", slug: "pricing", title: "Pricing" });
    });

    it('"make it green" -> change_color', async () => {
      const result = await classifyEditIntent("make it green", makeSpec());
      expect(result).toEqual({ kind: "change_color", color: "#1E8E5A" });
    });

    it('"add a blog" -> add_feature (no "page" word, so it never reaches the add_page branch)', async () => {
      const result = await classifyEditIntent("add a blog", makeSpec({ features: [] }));
      expect(result).toEqual({ kind: "add_feature", feature: "blog" });
    });

    it('"add a blog page" (explicit "page") -> add_page instead, since a known page word is present', async () => {
      const result = await classifyEditIntent("add a blog page", makeSpec());
      expect(result).toEqual({ kind: "add_page", slug: "blog", title: "Blog" });
    });

    it('"undo that" -> undo', async () => {
      expect(await classifyEditIntent("undo that", makeSpec())).toEqual({ kind: "undo" });
      expect(await classifyEditIntent("please revert the last change", makeSpec())).toEqual({ kind: "undo" });
      expect(await classifyEditIntent("roll back to before", makeSpec())).toEqual({ kind: "undo" });
    });

    it('"restart the environment" -> restart_environment', async () => {
      const result = await classifyEditIntent("please restart the environment", makeSpec());
      expect(result).toEqual({ kind: "restart_environment" });
    });

    it('"delete the pricing page" -> remove_page', async () => {
      const result = await classifyEditIntent("delete the pricing page", makeSpec({ pages: ["home", "pricing"] }));
      expect(result).toEqual({ kind: "remove_page", slug: "pricing" });
    });

    it("remove_page also matches a page slug already on the spec even if it's not in the known-word list", async () => {
      const result = await classifyEditIntent(
        "please remove the case-studies page",
        makeSpec({ pages: ["home", "case-studies"] }),
      );
      expect(result).toEqual({ kind: "remove_page", slug: "case-studies" });
    });

    it('a custom-named page ("add a page called Our Story") -> add_page with a slugified name', async () => {
      const result = await classifyEditIntent('add a page called "Our Story"', makeSpec());
      expect(result).toEqual({ kind: "add_page", slug: "our-story", title: "Our story" });
    });

    it('"change the style to be more corporate" -> change_style', async () => {
      const result = await classifyEditIntent("change the style to be more corporate and professional", makeSpec());
      expect(result).toEqual({ kind: "change_style", style: "corporate" });
    });

    it("an already-present feature is not re-offered as add_feature (falls through to unknown)", async () => {
      const result = await classifyEditIntent("add a blog", makeSpec({ features: ["blog"] }));
      expect(result).toEqual({ kind: "unknown", raw: "add a blog" });
    });

    it("degrades sensibly (no throw, kind: unknown) for ambiguous/unclear input", async () => {
      const result = await classifyEditIntent("hmm, not sure, maybe tweak it a little?", makeSpec());
      expect(result.kind).toBe("unknown");
      expect((result as { raw: string }).raw).toBe("hmm, not sure, maybe tweak it a little?");
    });

    it("degrades sensibly for empty/whitespace-only input", async () => {
      const result = await classifyEditIntent("   ", makeSpec());
      expect(result.kind).toBe("unknown");
    });
  });

  describe("skill-discovery path (skills.ts, mocked)", () => {
    it("returns add_skill when a capability is named and a verified plugin is found", async () => {
      vi.mocked(skillDiscoveryEnabled).mockReturnValue(true);
      vi.mocked(extractSkillMention).mockReturnValue("real estate listings");
      vi.mocked(discoverSkillPlugin).mockResolvedValue({
        slug: "real-estate-7",
        name: "Real Estate 7",
        query: "real estate listings",
        source: "wordpress.org",
      });

      const result = await classifyEditIntent("please add a real estate listings plugin", makeSpec());
      expect(result).toEqual({
        kind: "add_skill",
        query: "real estate listings",
        slug: "real-estate-7",
        name: "Real Estate 7",
      });
    });

    it("falls through to unknown (not add_skill) when no verified plugin is found", async () => {
      vi.mocked(skillDiscoveryEnabled).mockReturnValue(true);
      vi.mocked(extractSkillMention).mockReturnValue("something obscure");
      vi.mocked(discoverSkillPlugin).mockResolvedValue(null);

      const result = await classifyEditIntent("please add a something obscure plugin", makeSpec());
      expect(result.kind).toBe("unknown");
    });

    it("never invokes skill discovery when SKILL_SOURCE=curated (skillDiscoveryEnabled false)", async () => {
      vi.mocked(skillDiscoveryEnabled).mockReturnValue(false);
      await classifyEditIntent("please add a real estate listings plugin", makeSpec());
      expect(discoverSkillPlugin).not.toHaveBeenCalled();
    });

    it("skips a skill already known to the spec (already discovered)", async () => {
      vi.mocked(skillDiscoveryEnabled).mockReturnValue(true);
      vi.mocked(extractSkillMention).mockReturnValue("real estate listings");
      vi.mocked(discoverSkillPlugin).mockResolvedValue({
        slug: "real-estate-7",
        name: "Real Estate 7",
        query: "real estate listings",
        source: "wordpress.org",
      });
      const spec = makeSpec({
        discoveredSkills: [{ slug: "real-estate-7", name: "Real Estate 7", query: "real estate listings", source: "wordpress.org" }],
      });

      const result = await classifyEditIntent("please add a real estate listings plugin", spec);
      expect(result.kind).not.toBe("add_skill");
    });
  });

  describe("AI-provider path", () => {
    beforeEach(() => vi.mocked(aiAvailable).mockReturnValue(true));

    it("only reaches the AI classifier when the heuristic (and skill path) found nothing", async () => {
      vi.mocked(completeText).mockResolvedValue('{"kind": "change_style", "style": "modern"}');
      const result = await classifyEditIntent("can you tweak the overall look a bit?", makeSpec());
      expect(result).toEqual({ kind: "change_style", style: "modern" });
      expect(completeText).toHaveBeenCalledTimes(1);
    });

    it("does NOT call the AI classifier when the heuristic already produced a confident result", async () => {
      const result = await classifyEditIntent("undo that", makeSpec());
      expect(result).toEqual({ kind: "undo" });
      expect(completeText).not.toHaveBeenCalled();
    });

    it("classifies add_page from an AI reply that gives only a title, deriving the slug", async () => {
      vi.mocked(completeText).mockResolvedValue('{"kind": "add_page", "title": "Our Team"}');
      const result = await classifyEditIntent("can you add a section introducing everyone who works here?", makeSpec());
      expect(result).toEqual({ kind: "add_page", slug: "our-team", title: "Our Team" });
    });

    it("classifies remove_page, change_color, add_feature, and restart_environment from valid AI replies", async () => {
      vi.mocked(completeText).mockResolvedValueOnce('{"kind": "remove_page", "slug": "Old Page"}');
      expect(await classifyEditIntent("get rid of that old thing", makeSpec())).toEqual({
        kind: "remove_page",
        slug: "old-page",
      });

      vi.mocked(completeText).mockResolvedValueOnce('{"kind": "change_color", "color": "#112233"}');
      expect(await classifyEditIntent("tweak the accent a bit", makeSpec())).toEqual({
        kind: "change_color",
        color: "#112233",
      });

      vi.mocked(completeText).mockResolvedValueOnce('{"kind": "add_feature", "feature": "live-chat"}');
      expect(await classifyEditIntent("can visitors message us directly?", makeSpec())).toEqual({
        kind: "add_feature",
        feature: "live-chat",
      });

      vi.mocked(completeText).mockResolvedValueOnce('{"kind": "restart_environment"}');
      expect(await classifyEditIntent("something's stuck, can you kick it?", makeSpec())).toEqual({
        kind: "restart_environment",
      });
    });

    it("never trusts an AI-produced add_skill kind -- it isn't in the classifier's own switch statement", async () => {
      vi.mocked(completeText).mockResolvedValue(
        '{"kind": "add_skill", "slug": "some-plugin", "name": "Some Plugin"}',
      );
      const result = await classifyEditIntent("something ambiguous the AI might over-interpret", makeSpec());
      // falls through switch's default -> null -> classifyEditIntent falls back to the heuristic (unknown)
      expect(result.kind).toBe("unknown");
    });

    it("degrades to the heuristic's unknown result, without throwing, when completeText returns null", async () => {
      vi.mocked(completeText).mockResolvedValue(null);
      const result = await classifyEditIntent("something ambiguous", makeSpec());
      expect(result.kind).toBe("unknown");
    });

    it("degrades to the heuristic's unknown result, without throwing, when completeText returns unparseable JSON", async () => {
      vi.mocked(completeText).mockResolvedValue("sure, I'll get right on that!");
      const result = await classifyEditIntent("something ambiguous", makeSpec());
      expect(result.kind).toBe("unknown");
    });

    it("degrades to the heuristic's unknown result when add_page/remove_page/etc. are missing their required field", async () => {
      vi.mocked(completeText).mockResolvedValue('{"kind": "add_page"}'); // no slug or title
      const result = await classifyEditIntent("add something, not sure what", makeSpec());
      expect(result.kind).toBe("unknown");
    });
  });
});
