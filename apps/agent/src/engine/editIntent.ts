import type { SiteSpecification } from "@ai-wp/shared";
import { aiAvailable, completeText } from "../llm/client.js";
import { COLOR_MAP, COLOR_WORDS, FEATURE_KEYWORDS, STYLE_KEYWORDS, detectFromKeywords } from "./requirements.js";
import { discoverSkillPlugin, extractSkillMention, skillDiscoveryEnabled } from "./skills.js";

/**
 * GEN-09/PRV-04: turns a post-READY chat message into one small, structured
 * intent instead of silently re-running spec extraction. This is what makes
 * "targeted diffs, not full rebuilds" possible -- the incremental applier in
 * engine/incremental.ts only ever executes the single change described here.
 */

export type EditIntent =
  | { kind: "add_page"; slug: string; title: string }
  | { kind: "remove_page"; slug: string }
  | { kind: "change_color"; color: string }
  | { kind: "change_style"; style: string }
  | { kind: "add_feature"; feature: string }
  | { kind: "add_skill"; query: string; slug: string; name: string }
  | { kind: "restart_environment" }
  | { kind: "undo" }
  | { kind: "unknown"; raw: string };

const KNOWN_PAGE_WORDS = [
  "pricing", "team", "gallery", "blog", "faq", "testimonials", "careers", "services", "portfolio", "events", "shop",
];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function heuristicIntent(text: string, spec: SiteSpecification): EditIntent {
  const lower = text.toLowerCase();

  if (/\bundo\b|\brevert\b|roll ?back/.test(lower)) return { kind: "undo" };
  if (/\brestart\b/.test(lower) && /(environment|site|wordpress|server|container)/.test(lower)) {
    return { kind: "restart_environment" };
  }

  if (/\b(remove|delete)\b/.test(lower) && /\bpage\b/.test(lower)) {
    const pageWord =
      KNOWN_PAGE_WORDS.find((w) => lower.includes(w)) ?? spec.pages.find((p) => lower.includes(p));
    if (pageWord) return { kind: "remove_page", slug: slugify(pageWord) };
  }

  if (/\b(add|create)\b/.test(lower) && /\bpage\b/.test(lower)) {
    const pageWord = KNOWN_PAGE_WORDS.find((w) => lower.includes(w));
    if (pageWord) return { kind: "add_page", slug: slugify(pageWord), title: pageWord[0].toUpperCase() + pageWord.slice(1) };
    const named = lower.match(/(?:called|named)\s+"?([a-z0-9 -]+)"?/);
    if (named) {
      const title = named[1].trim();
      return { kind: "add_page", slug: slugify(title), title: title[0].toUpperCase() + title.slice(1) };
    }
  }

  if (/(color|colour|theme|make it|change it to)/.test(lower)) {
    const color = COLOR_WORDS.find((c) => lower.includes(c));
    if (color) return { kind: "change_color", color: COLOR_MAP[color] };
  }

  const styles = detectFromKeywords(text, STYLE_KEYWORDS);
  if (styles.length) return { kind: "change_style", style: styles[0] };

  const features = detectFromKeywords(text, FEATURE_KEYWORDS);
  const newFeature = features.find((f) => !spec.features.includes(f));
  if (newFeature) return { kind: "add_feature", feature: newFeature };

  return { kind: "unknown", raw: text };
}

interface AiIntent {
  kind?: EditIntent["kind"];
  slug?: string;
  title?: string;
  color?: string;
  style?: string;
  feature?: string;
}

async function aiIntent(text: string, spec: SiteSpecification): Promise<EditIntent | null> {
  const reply = await completeText({
    maxTokens: 250,
    system:
      "The site has already been built. Classify this chat message as ONE structured edit intent, JSON only: " +
      '{"kind": "add_page"|"remove_page"|"change_color"|"change_style"|"add_feature"|"restart_environment"|"undo"|"unknown", ' +
      '"slug"?: string, "title"?: string, "color"?: string (hex), "style"?: string, "feature"?: string}. ' +
      `Current pages: ${spec.pages.join(", ")}. Current features: ${spec.features.join(", ")}. No prose.`,
    prompt: text,
  });
  if (!reply) return null;
  try {
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as AiIntent;
    switch (parsed.kind) {
      case "add_page":
        return parsed.slug || parsed.title
          ? { kind: "add_page", slug: slugify(parsed.slug ?? parsed.title!), title: parsed.title ?? parsed.slug! }
          : null;
      case "remove_page":
        return parsed.slug ? { kind: "remove_page", slug: slugify(parsed.slug) } : null;
      case "change_color":
        return parsed.color ? { kind: "change_color", color: parsed.color } : null;
      case "change_style":
        return parsed.style ? { kind: "change_style", style: parsed.style } : null;
      case "add_feature":
        return parsed.feature ? { kind: "add_feature", feature: parsed.feature } : null;
      case "restart_environment":
        return { kind: "restart_environment" };
      case "undo":
        return { kind: "undo" };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Live skill-pack discovery for post-READY chat edits (engine/skills.ts):
 * only reachable via this explicit heuristic + WordPress.org-verified path,
 * never via aiIntent's JSON parsing below -- the model has no way to confirm
 * a plugin slug actually exists, so letting it emit "add_skill" directly
 * would mean installing a hallucinated slug. classifyEditIntent tries this
 * before falling back to the AI classifier, and the AI classifier's own
 * switch statement has no "add_skill" case, so it can never produce one.
 */
async function skillIntent(text: string, spec: SiteSpecification): Promise<EditIntent | null> {
  if (!skillDiscoveryEnabled()) return null;
  const mention = extractSkillMention(text);
  if (!mention) return null;
  const known = new Set(spec.discoveredSkills.map((s) => s.slug));
  const skill = await discoverSkillPlugin(mention);
  if (!skill || known.has(skill.slug)) return null;
  return { kind: "add_skill", query: mention, slug: skill.slug, name: skill.name };
}

export async function classifyEditIntent(text: string, spec: SiteSpecification): Promise<EditIntent> {
  const heuristic = heuristicIntent(text, spec);
  if (heuristic.kind !== "unknown") return heuristic;

  const skill = await skillIntent(text, spec);
  if (skill) return skill;

  if (aiAvailable()) {
    const ai = await aiIntent(text, spec);
    if (ai) return ai;
  }
  return heuristic;
}
