import type { SiteSpecification } from "@ai-wp/shared";
import { aiAvailable, completeText } from "../llm/client.js";
import {
  placeholderTeam,
  placeholderTestimonials,
  placeholderFaqs,
  placeholderGalleryItems,
  placeholderCaseStudies,
  placeholderJobs,
  placeholderEvents,
  placeholderMenu,
  placeholderPricingTiers,
  placeholderMembershipTiers,
} from "./templates.js";

/**
 * GEN-05b: AI generation for the "supporting content" every non-home page
 * type needs beyond its headline/body copy (copywriter.ts covers that part)
 * -- testimonials, FAQs, team bios, pricing, case studies, job listings,
 * events, menu items, membership tiers, gallery captions.
 *
 * Before this module, all of that came from templates.ts's placeholder*()
 * generators: fixed, generic filler ("Sample Customer", "Team Member 1",
 * "Open Role 1") reused verbatim across every site regardless of what the
 * site is actually about. That's the single biggest source of every
 * generated site "feeling templated" -- the hero/body copy was already
 * AI-written, but the supporting sections around it never were.
 *
 * Same two-mode pattern as copywriter.ts: try one JSON-only AI call tailored
 * to the site's type/audience/features, fall back to the deterministic
 * placeholder generators (per-field, not all-or-nothing) on any failure or
 * when no provider is configured. templates.ts's buildPageContent doesn't
 * know or care which mode produced what it's rendering.
 *
 * Guardrail carried over from the old placeholder copy: never fabricate
 * specific real people, customers, dates, counts, or awards. The AI prompts
 * below explicitly keep names/attribution generic ("Sample Customer",
 * "Team Member N") while asking for the *substance* (the quote, the
 * question, the dish, the role) to be specific to this business -- that's
 * the difference between "personalized" and "deceptive".
 */

// Exported for engine/layout.ts (GEN-11): a bonus section a layout plan
// picks (e.g. "testimonials") maps directly onto one of these keys so it can
// ask for exactly the supporting content it needs, for a page slug that
// PAGE_CONTENT_KEYS below wouldn't otherwise generate any for.
export type ContentKey = keyof SupportingContent;

export interface SupportingContent {
  testimonials?: Array<{ quote: string; author: string; role?: string }>;
  faqs?: Array<{ question: string; answer: string }>;
  team?: Array<{ name: string; role: string }>;
  pricingTiers?: Array<{ name: string; price: string; features: string[]; highlight?: boolean }>;
  caseStudies?: Array<{ title: string; body: string }>;
  jobs?: Array<{ title: string; meta: string; body: string; tag: string }>;
  events?: Array<{ title: string; meta: string; body: string; tag: string }>;
  menuItems?: Array<{ title: string; meta: string; body: string }>;
  membershipTiers?: Array<{ name: string; price: string; features: string[]; highlight?: boolean }>;
  galleryItems?: Array<{ label: string; caption?: string }>;
}

/** Which supporting-content field(s) a given page slug actually needs -- no point calling the model for pages that don't use any of this. */
const PAGE_CONTENT_KEYS: Record<string, ContentKey[]> = {
  team: ["team"],
  pricing: ["pricingTiers"],
  testimonials: ["testimonials"],
  faq: ["faqs"],
  gallery: ["galleryItems"],
  projects: ["galleryItems"],
  "case-studies": ["caseStudies"],
  careers: ["jobs"],
  events: ["events"],
  menu: ["menuItems"],
  members: ["membershipTiers"],
};

/** Exported for engine/layout.ts's AI layout planner -- same site-context blurb, one source of truth. */
export function siteContext(spec: SiteSpecification): string {
  return [
    `Business name: ${spec.site.name}`,
    `Type: ${spec.site.type || "business"}`,
    `Industry: ${spec.site.industry || "general"}`,
    `Audience: ${spec.site.audience.join(", ") || "general public"}`,
    `Features: ${spec.features.join(", ") || "none"}`,
    `Visual style: ${spec.design.style || "modern"}`,
  ].join("\n");
}

const GUARDRAIL =
  "Do not invent specific real people, real customer names, dates, statistics, awards, or other facts that would " +
  "misrepresent this business -- the site owner hasn't provided any of that yet. Keep names/attribution clearly " +
  'generic and replaceable (e.g. "Sample Customer", "Team Member 1"), but make the actual wording (the quote, ' +
  "question, dish, role, or project description) specific and realistic for this particular business, not generic filler.";

const FIELD_PROMPTS: Record<ContentKey, { instructions: string; count: number }> = {
  testimonials: {
    instructions:
      'testimonials: array of {"quote": string, "author": string, "role"?: string}. Each quote should reference ' +
      "something concrete and plausible about what this specific business offers, not a generic compliment.",
    count: 3,
  },
  faqs: {
    instructions:
      'faqs: array of {"question": string, "answer": string}. Questions a real prospective customer of THIS ' +
      "business would actually ask (pricing, process, how it works, what's included) -- not boilerplate.",
    count: 4,
  },
  team: {
    instructions:
      'team: array of {"name": string, "role": string}. Roles should be the ones this specific type of business ' +
      'would realistically have (e.g. a restaurant has a Head Chef, not a "Product Lead"). Keep `name` generic ' +
      'placeholders like "Team Member 1".',
    count: 4,
  },
  pricingTiers: {
    instructions:
      'pricingTiers: array of {"name": string, "price": string, "features": string[] (3-4 items), "highlight"?: boolean}. ' +
      "Exactly 3 tiers shaped like real plans for this specific kind of business (a SaaS startup, a service " +
      "business, and a membership org all price very differently). Mark the recommended tier highlight:true.",
    count: 3,
  },
  caseStudies: {
    instructions:
      'caseStudies: array of {"title": string, "body": string}. Plausible sample projects for this business\'s ' +
      'actual line of work -- generic "Project A" titles are not acceptable, but don\'t claim a real named client.',
    count: 3,
  },
  jobs: {
    instructions:
      'jobs: array of {"title": string, "meta": string, "body": string, "tag": string}. Realistic open-role titles ' +
      "for this specific business (not generic \"Open Role 1\"). `meta` is like \"Full-time · Remote\", `tag` is " +
      'like "Hiring".',
    count: 2,
  },
  events: {
    instructions:
      'events: array of {"title": string, "meta": string, "body": string, "tag": string}. Realistic event types ' +
      'this business/org would actually host. `meta` should stay a generic placeholder like "Date & time to be ' +
      'announced" since no real date is known. `tag` is like "Upcoming".',
    count: 2,
  },
  menuItems: {
    instructions:
      'menuItems: array of {"title": string, "meta": string, "body": string}. Realistic dish names and appetizing ' +
      'one-line descriptions fitting this restaurant\'s apparent cuisine/style. `meta` is the price, e.g. "$18".',
    count: 3,
  },
  membershipTiers: {
    instructions:
      'membershipTiers: array of {"name": string, "price": string, "features": string[], "highlight"?: boolean}. ' +
      "Exactly 3 membership tiers realistic for this specific organization.",
    count: 3,
  },
  galleryItems: {
    instructions:
      'galleryItems: array of {"label": string, "caption": string}. No real photos exist yet, so `label` stays a ' +
      'generic "Image N", but `caption` should describe a specific, plausible photo for this business (e.g. for a ' +
      'restaurant: "The dining room during a Friday evening service") -- replaceable, but not generic.',
    count: 6,
  },
};

function heuristicField(key: ContentKey, spec: SiteSpecification, pageSlug: string): unknown {
  switch (key) {
    case "team":
      return placeholderTeam();
    case "testimonials":
      return placeholderTestimonials(spec);
    case "faqs":
      return placeholderFaqs(spec);
    case "galleryItems":
      return placeholderGalleryItems(6, pageSlug === "projects" ? "Project" : "Photo");
    case "caseStudies":
      return placeholderCaseStudies(spec);
    case "jobs":
      return placeholderJobs(spec);
    case "events":
      return placeholderEvents();
    case "menuItems":
      return placeholderMenu();
    case "pricingTiers":
      return placeholderPricingTiers();
    case "membershipTiers":
      return placeholderMembershipTiers();
  }
}

function heuristicSupportingContent(keys: ContentKey[], pageSlug: string, spec: SiteSpecification): SupportingContent {
  const result: SupportingContent = {};
  for (const key of keys) {
    (result as Record<ContentKey, unknown>)[key] = heuristicField(key, spec, pageSlug);
  }
  return result;
}

async function aiSupportingContent(
  keys: ContentKey[],
  pageSlug: string,
  spec: SiteSpecification,
): Promise<Partial<SupportingContent> | null> {
  const fieldBlocks = keys.map((k) => `- ${FIELD_PROMPTS[k].instructions} (exactly ${FIELD_PROMPTS[k].count} items)`);
  const reply = await completeText({
    maxTokens: 900,
    system:
      "You write realistic, business-specific placeholder content for a WordPress site generator, for the " +
      `"${pageSlug}" page. Reply with JSON only, an object with exactly these key(s):\n${fieldBlocks.join("\n")}\n` +
      `${GUARDRAIL}\nNo prose before or after the JSON.`,
    prompt: siteContext(spec),
  });
  if (!reply) return null;
  try {
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Partial<Record<ContentKey, unknown>>;
    const result: Partial<SupportingContent> = {};
    for (const key of keys) {
      const value = parsed[key];
      if (Array.isArray(value) && value.length > 0) {
        (result as Record<ContentKey, unknown>)[key] = value;
      }
    }
    return result;
  } catch {
    return null; // fall back to heuristic content on any parse error
  }
}

/**
 * Generates whichever supporting-content field(s) `pageSlug` needs, AI-first
 * with a per-field heuristic fallback -- a partial/malformed AI response
 * still gets the fields it did produce, and only the missing ones fall back.
 *
 * `extraKeys` (GEN-11) lets engine/layout.ts request content for a bonus
 * section a page wasn't otherwise going to have any supporting content for
 * -- e.g. a "testimonials" bonus on the home page -- without PAGE_CONTENT_KEYS
 * itself needing to hardcode every page a layout plan might ever add one to.
 */
export async function generateSupportingContent(
  pageSlug: string,
  spec: SiteSpecification,
  extraKeys: ContentKey[] = [],
): Promise<SupportingContent> {
  const keys = Array.from(new Set([...(PAGE_CONTENT_KEYS[pageSlug] ?? []), ...extraKeys]));
  if (keys.length === 0) return {};

  const heuristic = heuristicSupportingContent(keys, pageSlug, spec);
  if (!aiAvailable()) return heuristic;

  const ai = await aiSupportingContent(keys, pageSlug, spec);
  if (!ai) return heuristic;

  return { ...heuristic, ...ai };
}
