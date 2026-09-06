/**
 * Live "skill pack" discovery -- dynamic plugin lookup against the public
 * WordPress.org plugin directory.
 *
 * tools/plugins.ts's ALLOWED_PLUGINS / FEATURE_PLUGIN_MAP is a small, curated,
 * fully-offline catalog: a fixed vocabulary of feature keywords mapped to a
 * fixed set of plugin slugs. That's deliberate (spec section 17 wants
 * zero-network-required behavior by default) but it means any capability a
 * user asks for by name that isn't in that vocabulary -- "add a real estate
 * listings feature", "install the WP Rocket plugin", "using an LMS skill for
 * courses" -- previously fell through to `unknown` with nothing built.
 *
 * This module is the live counterpart, mirroring engine/themes.ts's THM-04
 * live WordPress.org theme search exactly:
 *  - same shape (AbortController timeout, short in-memory TTL cache, swallow
 *    every network/parse failure into "no result" so offline dev is
 *    unaffected and this is never what takes a request down),
 *  - same "discovered slugs join a live-allowlist Set" pattern, so
 *    tools/dispatcher.ts's SEC-06 plugin allowlist (isAllowedPlugin) can
 *    trust a live find without a code change every time a new skill is
 *    discovered,
 *  - same env-var opt-out (THEME_SOURCE=catalog there, SKILL_SOURCE=curated
 *    here) for fully offline/deterministic runs (tests, air-gapped dev).
 *
 * Quality bar: only a plugin that's popular *and* well-rated is ever
 * returned, and only after its slug passes a strict allowlist-safe format
 * check -- untrusted API response data must never be treated as more than a
 * plugin slug string.
 */

import type { DiscoveredSkillRef } from "@ai-wp/shared";

export type DiscoveredSkill = DiscoveredSkillRef;

const liveDiscoveredSlugs = new Set<string>();

/** Extends tools/plugins.ts's isAllowedPlugin -- called from there, not the other way round. */
export function isDiscoveredSkillPlugin(slug: string): boolean {
  return liveDiscoveredSlugs.has(slug);
}

export function skillDiscoveryEnabled(): boolean {
  return process.env.SKILL_SOURCE !== "curated";
}

/**
 * Heuristic extraction of "the user is naming a capability to add" from free
 * text, e.g. "add a real estate listings feature" -> "real estate listings".
 * Deliberately narrow -- requires both an add/need/want-style verb *and* a
 * feature/plugin/system-style noun -- so it only fires on an explicit
 * request, never on incidental mentions. A false negative just means no live
 * search happens (same as today); a false positive just means one extra,
 * harmless WordPress.org query.
 */
const SKILL_MENTION_RE =
  /\b(?:add|include|need|want|set ?up|integrate|install|use|using|looking for)\b[\s\S]{0,50}?\b(?:a|an|the)?\s*([a-z][a-z0-9&' -]{2,48}?)\s+(?:plugin|feature|functionality|integration|system|widget|skill)\b/i;

export function extractSkillMention(text: string): string | null {
  const match = text.match(SKILL_MENTION_RE);
  if (!match) return null;
  const query = match[1].replace(/\s+/g, " ").trim();
  return query.length >= 3 ? query : null;
}

interface WpOrgPluginApiResult {
  slug: string;
  name: string;
  short_description?: string;
  rating?: number; // 0-100
  active_installs?: number;
}

const SLUG_RE = /^[a-z0-9-]+$/;
const MIN_RATING = 60; // out of 100 -- keeps out poorly-reviewed/abandoned plugins
const MIN_ACTIVE_INSTALLS = 1000; // keeps out obscure/unvetted plugins

const searchCache = new Map<string, { at: number; result: DiscoveredSkill | null }>();
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Searches the public WordPress.org plugin directory for a skill matching
 * `query` and returns the best result that clears the quality bar above, or
 * null if nothing does (or the API is unreachable). Callers still go through
 * tools/dispatcher.ts's install_plugin -- this only decides *whether a slug
 * is trustworthy enough to hand it*, never installs anything itself.
 */
export async function discoverSkillPlugin(query: string): Promise<DiscoveredSkill | null> {
  const cacheKey = query.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const url = new URL("https://api.wordpress.org/plugins/info/1.2/");
    url.searchParams.set("action", "query_plugins");
    url.searchParams.set("request[search]", query);
    url.searchParams.set("request[per_page]", "5");

    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { plugins?: WpOrgPluginApiResult[] };
    const best = (body.plugins ?? []).find(
      (p) =>
        typeof p.slug === "string" &&
        SLUG_RE.test(p.slug) &&
        (p.active_installs ?? 0) >= MIN_ACTIVE_INSTALLS &&
        (p.rating ?? 0) >= MIN_RATING,
    );
    const result: DiscoveredSkill | null = best
      ? {
          slug: best.slug,
          name: best.name,
          query,
          source: "wordpress.org",
        }
      : null;
    if (result) liveDiscoveredSlugs.add(result.slug);
    searchCache.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch {
    return null; // offline / API down / no qualifying match -- treat like "nothing found"
  } finally {
    clearTimeout(timeout);
  }
}
