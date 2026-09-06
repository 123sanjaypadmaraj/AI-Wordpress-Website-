import type { SiteSpecification } from "@ai-wp/shared";
import { aiAvailable, completeText } from "../llm/client.js";
import { siteContext, type ContentKey } from "./contentGenerator.js";

/**
 * GEN-11: AI-driven section/layout composition -- the phase after GEN-10's
 * design system. Until now, engine/templates.ts's buildPageContent picked a
 * fixed, hardcoded sequence of sections for every page of a given slug: every
 * "home" page got exactly hero -> features -> (stats?) -> cta, every "about"
 * page got exactly hero -> body text, no matter what the business actually
 * is. That's a layout, but not a *composed* one.
 *
 * This module decides, per page, which optional "bonus" sections
 * (engine/templates.ts's renderBonusSections) get appended after that page's
 * own core content, and in what order -- e.g. a service business's About
 * page might earn a trust-building stats band and testimonials, while a
 * one-person portfolio's shouldn't. Same two-mode shape as every other
 * engine module: a conservative, deterministic heuristic (safe enough to be
 * the actual offline default) upgraded to an AI-informed pick -- still
 * constrained to a fixed, validated vocabulary of section kinds, so this can
 * never invent a section templates.ts doesn't know how to render.
 */

export type BonusSection = "features" | "stats" | "testimonials" | "faq" | "cta";

export interface PageLayoutPlan {
  bonus: BonusSection[]; // in the order they should render, after the page's core content
}

const ALL_BONUS_SECTIONS: BonusSection[] = ["features", "stats", "testimonials", "faq", "cta"];

/**
 * Which pages are even eligible for which bonus sections, and which section
 * is already that page's own core content (so it's not offered again as a
 * "bonus" -- e.g. "services" already renders copy.features as its main
 * content, so "features" isn't in its eligible list, but "about" doesn't use
 * copy.features at all today, so it is).
 */
const ELIGIBLE_BONUS: Record<string, BonusSection[]> = {
  home: ["stats", "testimonials", "faq", "cta"],
  about: ["features", "stats", "testimonials", "faq", "cta"],
  services: ["stats", "testimonials", "faq", "cta"],
  programs: ["stats", "testimonials", "faq", "cta"],
  "case-studies": ["features", "stats", "testimonials", "cta"],
  members: ["testimonials", "faq", "cta"],
};

export function eligibleBonusSections(pageSlug: string): BonusSection[] {
  return ELIGIBLE_BONUS[pageSlug] ?? [];
}

/**
 * The fully-offline default. Deliberately conservative: it reproduces
 * exactly what "home" already looked like before this module existed (a
 * stats band only when there's something to count, a closing CTA always),
 * and adds nothing but a closing CTA to the pages newly eligible for bonus
 * sections -- a tasteful, universally-safe addition, not a guess about
 * whether *this* about/services page specifically wants testimonials. That
 * guess is exactly what the AI planner below is for.
 */
export function heuristicLayoutPlan(pageSlug: string, spec: SiteSpecification): PageLayoutPlan {
  const eligible = eligibleBonusSections(pageSlug);
  if (eligible.length === 0) return { bonus: [] };

  if (pageSlug === "home") {
    const bonus: BonusSection[] = [];
    if (spec.features.length > 0) bonus.push("stats");
    bonus.push("cta");
    return { bonus };
  }

  return { bonus: eligible.includes("cta") ? ["cta"] : [] };
}

/** Which supporting-content field(s) (contentGenerator.ts) a bonus section needs, if any. */
export function bonusContentKeys(bonus: BonusSection[]): ContentKey[] {
  const keys: ContentKey[] = [];
  if (bonus.includes("testimonials")) keys.push("testimonials");
  if (bonus.includes("faq")) keys.push("faqs");
  return keys;
}

interface AiLayoutResponse {
  bonus?: string[];
}

/**
 * Asks the model to choose which of this page's eligible bonus sections
 * genuinely fit this specific business, and in what order. The response is
 * filtered down to the eligible set (deduped, capped) before it's trusted --
 * an unrecognized or hallucinated section name is silently dropped rather
 * than rendered, same "never trust free-form AI output past a strict
 * allowlist" posture as skills.ts's plugin-slug validation.
 */
async function aiLayoutPlan(pageSlug: string, spec: SiteSpecification, eligible: BonusSection[]): Promise<PageLayoutPlan | null> {
  const reply = await completeText({
    maxTokens: 100,
    system:
      `You are planning the section layout for the "${pageSlug}" page of a WordPress site. This page's own core ` +
      `content is already decided and comes first -- you're only choosing which OPTIONAL sections to append after ` +
      `it, and in what order. Choose from exactly this list: ${eligible.join(", ")}. ` +
      '"features" is a highlights grid ("what sets us apart"), "stats" is a short numeric-highlights band, ' +
      '"testimonials" is customer quotes, "faq" is a short Q&A teaser, "cta" is a closing call-to-action band. ' +
      "Only include a section that genuinely fits this specific business and page -- e.g. a brand-new one-person " +
      'studio\'s About page probably doesn\'t need "stats", but an established service business\'s does. It is ' +
      "fine to choose none, or all of them. Reply with JSON only: " +
      '{"bonus": string[]} using only names from the list above, in render order. No prose.',
    prompt: siteContext(spec) + `\nPage: ${pageSlug}`,
  });
  if (!reply) return null;
  try {
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as AiLayoutResponse;
    if (!Array.isArray(parsed.bonus)) return null;
    const eligibleSet = new Set(eligible);
    const seen = new Set<BonusSection>();
    const bonus: BonusSection[] = [];
    for (const raw of parsed.bonus) {
      const kind = typeof raw === "string" ? (raw.toLowerCase().trim() as BonusSection) : null;
      if (kind && eligibleSet.has(kind) && !seen.has(kind) && ALL_BONUS_SECTIONS.includes(kind)) {
        seen.add(kind);
        bonus.push(kind);
      }
    }
    return { bonus };
  } catch {
    return null; // fall back to the heuristic plan on any parse error
  }
}

/**
 * AI-first (when a provider is configured) with a full heuristic fallback --
 * unlike contentGenerator.ts's per-field merge, a layout plan is one
 * indivisible decision (the order matters as a whole), so an AI response
 * either replaces the heuristic plan entirely or is discarded in favor of it.
 */
export async function planPageLayout(pageSlug: string, spec: SiteSpecification): Promise<PageLayoutPlan> {
  const eligible = eligibleBonusSections(pageSlug);
  if (eligible.length === 0) return { bonus: [] };

  const heuristic = heuristicLayoutPlan(pageSlug, spec);
  if (!aiAvailable()) return heuristic;

  const ai = await aiLayoutPlan(pageSlug, spec, eligible);
  return ai ?? heuristic;
}
