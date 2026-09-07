import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractSkillMention,
  skillDiscoveryEnabled,
  discoverSkillPlugin,
  isDiscoveredSkillPlugin,
} from "../../../../apps/agent/src/engine/skills.js";

/**
 * discoverSkillPlugin() keeps a module-level in-memory cache (searchCache)
 * and a running Set of every slug it has ever returned (liveDiscoveredSlugs).
 * Every test below uses its own unique query string so cache hits/misses and
 * isDiscoveredSkillPlugin() assertions can't leak between test cases.
 */

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function pluginResult(overrides: Partial<{
  slug: string;
  name: string;
  rating: number;
  active_installs: number;
}> = {}) {
  return {
    slug: "real-estate-listings",
    name: "Real Estate Listings",
    rating: 90,
    active_installs: 50000,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SKILL_SOURCE;
});

describe("engine/skills.ts", () => {
  describe("extractSkillMention", () => {
    it.each([
      "add a real estate listings plugin",
      "I need a booking system feature",
      "please set up an events calendar integration",
      "can you install the WP Rocket plugin",
      "using an LMS skill for courses",
    ])("extracts a capability phrase from: %s", (text) => {
      expect(extractSkillMention(text)).not.toBeNull();
    });

    it("returns null for incidental mentions that aren't a request to add something", () => {
      expect(extractSkillMention("I really like the plugin you built last time")).toBeNull();
      expect(extractSkillMention("What's the weather like today?")).toBeNull();
    });

    it("returns null for text with no qualifying capability noun at all", () => {
      expect(extractSkillMention("add some spice to the homepage")).toBeNull();
    });
  });

  describe("skillDiscoveryEnabled", () => {
    it("is enabled by default (no SKILL_SOURCE env var set)", () => {
      delete process.env.SKILL_SOURCE;
      expect(skillDiscoveryEnabled()).toBe(true);
    });

    it("is disabled when SKILL_SOURCE=curated", () => {
      process.env.SKILL_SOURCE = "curated";
      expect(skillDiscoveryEnabled()).toBe(false);
    });

    it("stays enabled for any other SKILL_SOURCE value", () => {
      process.env.SKILL_SOURCE = "live";
      expect(skillDiscoveryEnabled()).toBe(true);
    });
  });

  describe("discoverSkillPlugin -- live wordpress.org lookup (network mocked)", () => {
    it("returns the best qualifying plugin match found", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ plugins: [pluginResult()] }));
      const result = await discoverSkillPlugin("real estate listings unique-1");
      expect(result).toEqual({
        slug: "real-estate-listings",
        name: "Real Estate Listings",
        query: "real estate listings unique-1",
        source: "wordpress.org",
      });
    });

    it("registers a found slug with isDiscoveredSkillPlugin so the dispatcher's allowlist can trust it", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ plugins: [pluginResult({ slug: "yoga-class-scheduler" })] }),
      );
      expect(isDiscoveredSkillPlugin("yoga-class-scheduler")).toBe(false);
      await discoverSkillPlugin("yoga scheduling unique-2");
      expect(isDiscoveredSkillPlugin("yoga-class-scheduler")).toBe(true);
    });

    it("degrades to null (no match) when nothing clears the rating/installs quality bar", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          plugins: [
            pluginResult({ slug: "low-rated-plugin", rating: 40 }),
            pluginResult({ slug: "obscure-plugin", active_installs: 10 }),
          ],
        }),
      );
      const result = await discoverSkillPlugin("obscure capability unique-3");
      expect(result).toBeNull();
    });

    it("skips a candidate with an unsafe/invalid slug even if it otherwise qualifies, and picks the next valid one", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          plugins: [
            pluginResult({ slug: "Not_A-Valid.Slug!" }), // fails SLUG_RE
            pluginResult({ slug: "valid-fallback-slug" }),
          ],
        }),
      );
      const result = await discoverSkillPlugin("slug safety unique-4");
      expect(result?.slug).toBe("valid-fallback-slug");
    });

    it("degrades to null without throwing when the API responds with a non-ok status", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false));
      const result = await discoverSkillPlugin("server error case unique-5");
      expect(result).toBeNull();
    });

    it("degrades to null without throwing when the network request fails outright", async () => {
      fetchMock.mockRejectedValue(new Error("network unreachable"));
      const result = await discoverSkillPlugin("offline case unique-6");
      expect(result).toBeNull();
    });

    it("degrades to null without throwing when the response body isn't the expected shape", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ unexpected: "shape" }));
      const result = await discoverSkillPlugin("malformed body unique-7");
      expect(result).toBeNull();
    });

    it("caches a result for the same query and does not re-issue the network request", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ plugins: [pluginResult({ slug: "cached-plugin" })] }));
      const first = await discoverSkillPlugin("caching behavior unique-8");
      const second = await discoverSkillPlugin("caching behavior unique-8");
      expect(first).toEqual(second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("treats the query case-insensitively for caching purposes", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ plugins: [pluginResult({ slug: "case-cache-plugin" })] }));
      await discoverSkillPlugin("Case Sensitivity Unique-9");
      await discoverSkillPlugin("case sensitivity unique-9");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
