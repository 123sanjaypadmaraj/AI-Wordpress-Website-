import type { ChatChoice, RequirementSlots, SiteSpecification } from "@ai-wp/shared";
import { aiAvailable, completeText } from "../llm/client.js";
import { discoverSkillPlugin, extractSkillMention, skillDiscoveryEnabled } from "./skills.js";
import { heuristicDesignSystem } from "./designSystem.js";

/**
 * Requirement-gathering agent (spec section 7).
 *
 * Two modes:
 *  - Heuristic (default, no API key required): keyword-based slot filling.
 *    Deterministic and fully offline, so `npm run dev` works with zero setup.
 *  - AI-assisted (an API key set for any supported provider -- see
 *    llm/client.ts): asks the model to extract slots from free-form text as
 *    JSON. Same slot shape either way, so nothing downstream (spec builder,
 *    theme engine) needs to know which mode ran, or which provider answered.
 *
 * Either way the agent never re-asks a question a slot already answers --
 * that statefulness is the point of section 51 (AI agent memory).
 */

const WEBSITE_TYPES: Record<string, string[]> = {
  ecommerce: ["shop", "store", "sell", "ecommerce", "e-commerce", "online store"],
  portfolio: ["portfolio", "showcase my work", "photographer", "designer portfolio"],
  restaurant: ["restaurant", "cafe", "menu", "reservations", "food"],
  nonprofit: ["nonprofit", "non-profit", "charity", "ngo", "foundation"],
  club: ["club", "society", "association", "community group"],
  agency: ["agency", "consultancy", "consulting"],
  startup: ["startup", "start-up", "saas", "product launch"],
  blog: ["blog", "personal blog", "writer"],
  organization: ["organization", "organisation", "institute", "university", "school", "college"],
};

export const FEATURE_KEYWORDS: Record<string, string[]> = {
  "event-registration": ["event", "registration", "rsvp", "sign up for"],
  "project-showcase": ["projects", "showcase", "portfolio", "case studies"],
  "contact-form": ["contact", "get in touch", "reach us"],
  ecommerce: ["sell", "shop", "store", "checkout", "payments", "cart"],
  blog: ["blog", "news", "articles", "posts"],
  "team-page": ["team", "staff", "our people", "founders"],
  newsletter: ["newsletter", "subscribe", "mailing list"],
  booking: ["booking", "reservation", "appointment", "schedule a call"],
};

export const STYLE_KEYWORDS: Record<string, string[]> = {
  futuristic: ["futuristic", "sci-fi", "cyberpunk", "tech-forward"],
  minimal: ["minimal", "clean", "simple", "understated"],
  corporate: ["corporate", "professional", "enterprise", "formal"],
  playful: ["playful", "fun", "colorful", "vibrant"],
  premium: ["premium", "luxury", "high-end", "elegant"],
  bold: ["bold", "striking", "dramatic"],
};

export const COLOR_WORDS = [
  "blue", "purple", "violet", "green", "red", "orange", "yellow", "pink",
  "teal", "black", "dark", "light", "white", "navy", "indigo", "gold",
];

export const COLOR_MAP: Record<string, string> = {
  blue: "#3651D4", purple: "#6D3FD1", violet: "#6D3FD1", green: "#1E8E5A",
  red: "#C43D4B", orange: "#D97327", yellow: "#D4A72C", pink: "#D14F97",
  teal: "#1A9E8F", navy: "#1F2E6B", indigo: "#4338CA", gold: "#B8860B",
  black: "#111318", dark: "#111318", light: "#F7F7FA", white: "#F7F7FA",
};

const DEFAULT_PAGES = ["home", "about", "contact"];

const TYPE_PAGES: Record<string, string[]> = {
  ecommerce: ["shop", "product", "cart", "checkout"],
  portfolio: ["projects", "gallery"],
  restaurant: ["menu", "reservations"],
  nonprofit: ["donate", "programs"],
  club: ["events", "members"],
  agency: ["services", "case-studies"],
  startup: ["product", "pricing"],
  blog: ["blog"],
  organization: ["about", "programs", "team"],
};

const FEATURE_PAGES: Record<string, string> = {
  "event-registration": "events",
  "project-showcase": "projects",
  blog: "blog",
  "team-page": "team",
  ecommerce: "shop",
};

/**
 * Pages implied by the site type and any features chosen so far. Shown back
 * to the user as a starting point before we ask whether they want anything
 * beyond it -- this is what makes the pages question a suggestion ("here's
 * what I'd plan, want to add more?") instead of a blank "what pages do you
 * want?" that puts all the thinking on the user.
 */
function computeBasePages(slots: RequirementSlots): string[] {
  const pages = new Set(DEFAULT_PAGES);
  if (slots.websiteType && TYPE_PAGES[slots.websiteType]) {
    TYPE_PAGES[slots.websiteType].forEach((p) => pages.add(p));
  }
  (slots.features ?? []).forEach((f) => {
    if (FEATURE_PAGES[f]) pages.add(FEATURE_PAGES[f]);
  });
  return Array.from(pages);
}

// Friendly labels and per-type suggestions for the features and extra-pages
// questions below. This is the "get user suggestions too" piece: instead of
// a fixed, generic choice list, both questions propose options tailored to
// the site type that was already detected.
const TYPE_LABELS: Record<string, string> = {
  ecommerce: "online stores",
  portfolio: "portfolios",
  restaurant: "restaurants",
  nonprofit: "nonprofits",
  club: "clubs",
  agency: "agencies",
  startup: "startups",
  blog: "blogs",
  organization: "organizations",
};

const FEATURE_LABELS: Record<string, string> = {
  "event-registration": "Event registration",
  "project-showcase": "Project showcase",
  "contact-form": "Contact form",
  ecommerce: "Online payments",
  blog: "Blog / news",
  "team-page": "Team page",
  newsletter: "Newsletter signup",
  booking: "Booking / appointments",
};

const SUGGESTED_FEATURES_BY_TYPE: Record<string, string[]> = {
  ecommerce: ["ecommerce", "newsletter", "contact-form"],
  portfolio: ["project-showcase", "contact-form"],
  restaurant: ["booking", "contact-form"],
  nonprofit: ["event-registration", "newsletter", "contact-form"],
  club: ["event-registration", "team-page", "newsletter"],
  agency: ["project-showcase", "team-page", "contact-form"],
  startup: ["newsletter", "contact-form", "blog"],
  blog: ["blog", "newsletter"],
  organization: ["event-registration", "team-page", "contact-form"],
};
const DEFAULT_SUGGESTED_FEATURES = ["contact-form", "blog", "newsletter"];

function featureChoices(slots: RequirementSlots): ChatChoice[] {
  const suggested =
    (slots.websiteType ? SUGGESTED_FEATURES_BY_TYPE[slots.websiteType] : undefined) ?? DEFAULT_SUGGESTED_FEATURES;
  return [
    ...suggested.map((f) => ({ label: FEATURE_LABELS[f] ?? f, value: f })),
    { label: "None of these", value: "none" },
  ];
}

const EXTRA_PAGE_LABELS: Record<string, string> = {
  faq: "FAQ",
  gallery: "Gallery",
  pricing: "Pricing",
  testimonials: "Testimonials",
  careers: "Careers",
};

export const EXTRA_PAGE_KEYWORDS: Record<string, string[]> = {
  faq: ["faq", "frequently asked questions"],
  gallery: ["gallery", "photo gallery"],
  pricing: ["pricing", "plans page"],
  testimonials: ["testimonials", "reviews", "client feedback"],
  careers: ["careers", "jobs page", "hiring"],
};

const SUGGESTED_EXTRA_PAGES_BY_TYPE: Record<string, string[]> = {
  ecommerce: ["faq", "pricing", "testimonials"],
  portfolio: ["testimonials", "faq"],
  restaurant: ["gallery", "faq"],
  nonprofit: ["faq", "testimonials"],
  club: ["gallery", "faq"],
  agency: ["testimonials", "pricing", "faq"],
  startup: ["pricing", "testimonials", "faq"],
  blog: ["faq"],
  organization: ["faq", "gallery"],
};
const DEFAULT_SUGGESTED_EXTRA_PAGES = ["faq", "testimonials"];

function pageChoices(slots: RequirementSlots): ChatChoice[] {
  const planned = new Set(computeBasePages(slots));
  const suggested =
    (slots.websiteType ? SUGGESTED_EXTRA_PAGES_BY_TYPE[slots.websiteType] : undefined) ?? DEFAULT_SUGGESTED_EXTRA_PAGES;
  return [
    ...suggested.filter((p) => !planned.has(p)).map((p) => ({ label: EXTRA_PAGE_LABELS[p] ?? p, value: p })),
    { label: "Looks good", value: "none" },
  ];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bug fix: this used to be a plain `.includes()` substring check, which
 * false-positives on compound words -- "newsletter" contains "news", so
 * mentioning a newsletter silently also turned on the unrelated "blog"
 * feature (whose keyword list includes "news"). \b-bounded matching
 * requires the keyword to appear as its own word (or phrase, for
 * multi-word keywords), not merely as a substring of a longer one.
 */
export function detectFromKeywords(text: string, table: Record<string, string[]>): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const [key, words] of Object.entries(table)) {
    if (words.some((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(lower))) hits.push(key);
  }
  return hits;
}

function detectColor(text: string): string | null {
  const lower = text.toLowerCase();
  return COLOR_WORDS.find((c) => new RegExp(`\\b${escapeRegExp(c)}\\b`, "i").test(lower)) ?? null;
}

function heuristicExtract(text: string, slots: RequirementSlots): RequirementSlots {
  const next = { ...slots };
  const lower = text.toLowerCase();

  if (!next.websiteType) {
    const types = detectFromKeywords(text, WEBSITE_TYPES);
    if (types.length) next.websiteType = types[0];
  }

  const features = detectFromKeywords(text, FEATURE_KEYWORDS);
  if (features.length) {
    next.features = Array.from(new Set([...(next.features ?? []), ...features]));
  } else if (next.features === null && (lower.trim() === "none of these" || lower.trim() === "none")) {
    next.features = []; // explicit "no features" answer, not just "nothing detected yet"
  }

  if (next.pages === null) {
    const extraPages = detectFromKeywords(text, EXTRA_PAGE_KEYWORDS);
    if (extraPages.length) {
      next.pages = extraPages;
    } else if (["looks good", "none", "no thanks", "no"].includes(lower.trim())) {
      next.pages = []; // explicit "no extra pages" answer, not just "nothing detected yet"
    }
  }

  const styles = detectFromKeywords(text, STYLE_KEYWORDS);
  if (styles.length && !next.visualStyle) next.visualStyle = styles[0];

  const color = detectColor(text);
  if (color && !next.colorPreference) next.colorPreference = color;

  if (!next.audience) {
    if (lower.includes("student")) next.audience = ["students"];
    else if (lower.includes("customer") || lower.includes("client")) next.audience = ["customers"];
    else if (lower.includes("investor")) next.audience = ["investors"];
    else if (lower.includes("everyone") || lower.includes("general public")) next.audience = ["general public"];
  }

  // REQ-07: e-commerce / SEO / accessibility / integration follow-ups.
  // These are opportunistic like everything else above -- if a user
  // mentions Stripe on turn one, the ecommercePayment question never fires.
  if (!next.ecommercePayment) {
    if (lower.includes("stripe")) next.ecommercePayment = "stripe";
    else if (lower.includes("paypal")) next.ecommercePayment = "paypal";
    else if (lower.includes("woocommerce")) next.ecommercePayment = "woocommerce-payments";
  }

  if (next.integrations === null) {
    if (lower === "skip" || lower.includes("nothing else") || lower.includes("no thanks") || lower === "none") {
      next.integrations = [];
    } else {
      const mentionsSeo = lower.includes("seo");
      const mentionsAccessibility = lower.includes("accessib");
      const integrations = detectFromKeywords(text, INTEGRATION_KEYWORDS);
      if (mentionsSeo || mentionsAccessibility || integrations.length || lower.includes("seo-accessibility")) {
        if (mentionsSeo || lower.includes("seo-accessibility")) next.seo = true;
        if (mentionsAccessibility || lower.includes("seo-accessibility")) next.accessibility = true;
        next.integrations = integrations;
      }
    }
  }

  return next;
}

const INTEGRATION_KEYWORDS: Record<string, string[]> = {
  "google-analytics": ["google analytics", "analytics", "ga4"],
  mailchimp: ["mailchimp"],
  hubspot: ["hubspot"],
  zapier: ["zapier"],
  "google-maps": ["google maps", "maps embed"],
};

interface AiExtraction {
  websiteType?: string;
  audience?: string[];
  pages?: string[];
  features?: string[];
  visualStyle?: string;
  colorPreference?: string;
  ecommercePayment?: string;
  seo?: boolean;
  accessibility?: boolean;
  integrations?: string[];
  reply?: string;
}

async function aiExtract(text: string, slots: RequirementSlots): Promise<AiExtraction | null> {
  const reply = await completeText({
    maxTokens: 512,
    system:
      "You are the requirement-gathering module of an AI WordPress website builder. " +
      "Extract website requirements from the user's message as JSON only, matching this " +
      "TypeScript type exactly, with no prose before or after: " +
      '{"websiteType"?: string, "audience"?: string[], "pages"?: string[], "features"?: string[], ' +
      '"visualStyle"?: string, "colorPreference"?: string, "ecommercePayment"?: string, ' +
      '"seo"?: boolean, "accessibility"?: boolean, "integrations"?: string[], "reply"?: string}. ' +
      '`pages` is only for extra pages beyond the obvious ones implied by the site type (e.g. "faq", "pricing", "gallery", "testimonials", "careers"). ' +
      "Only include fields you are confident about. `reply` is one short, friendly " +
      "sentence acknowledging what you understood. Known slots so far: " +
      JSON.stringify(slots),
    prompt: text,
  });
  if (!reply) return null;
  try {
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as AiExtraction;
  } catch {
    return null; // fall back to heuristics on any parse error
  }
}

export interface RequirementTurnResult {
  slots: RequirementSlots;
  reply: string;
  choices?: ChatChoice[];
  specReady: boolean;
}

const NEXT_QUESTIONS: Array<{
  slot: keyof RequirementSlots;
  question: string | ((slots: RequirementSlots) => string);
  choices?: ChatChoice[] | ((slots: RequirementSlots) => ChatChoice[]);
  when?: (slots: RequirementSlots) => boolean;
}> = [
  {
    slot: "websiteType",
    question: "What kind of website is this for?",
    choices: [
      { label: "Business", value: "business" },
      { label: "Portfolio", value: "portfolio" },
      { label: "Blog", value: "blog" },
      { label: "Online store", value: "ecommerce" },
      { label: "Club / organization", value: "organization" },
    ],
  },
  {
    slot: "audience",
    question: "Who's the primary audience for the site?",
  },
  {
    slot: "features",
    question: (slots) =>
      slots.websiteType && TYPE_LABELS[slots.websiteType]
        ? `Here are some features ${TYPE_LABELS[slots.websiteType]} often add -- want any of these?`
        : "Want to add any commonly-requested features, like event registration or a blog?",
    choices: featureChoices,
  },
  {
    slot: "pages",
    question: (slots) => `I'd plan for these pages: ${computeBasePages(slots).join(", ")}. Want to add any more?`,
    choices: pageChoices,
  },
  {
    slot: "visualStyle",
    question: "What visual style do you have in mind?",
    choices: [
      { label: "Minimal", value: "minimal" },
      { label: "Futuristic", value: "futuristic" },
      { label: "Corporate", value: "corporate" },
      { label: "Playful", value: "playful" },
      { label: "Premium", value: "premium" },
    ],
  },
  {
    slot: "ecommercePayment",
    question: "Which payment method should the store support?",
    choices: [
      { label: "Stripe", value: "stripe" },
      { label: "PayPal", value: "paypal" },
      { label: "WooCommerce Payments", value: "woocommerce-payments" },
    ],
    when: (s) => s.websiteType === "ecommerce" || (s.features ?? []).includes("ecommerce"),
  },
  {
    slot: "integrations",
    question:
      'Anything else -- SEO basics, accessibility helpers, or integrations like Google Analytics or Mailchimp? Say what you need, or "skip".',
    choices: [
      { label: "SEO + accessibility basics", value: "seo-accessibility" },
      { label: "Skip", value: "skip" },
    ],
  },
];

function resolveText(value: string | ((slots: RequirementSlots) => string), slots: RequirementSlots): string {
  return typeof value === "function" ? value(slots) : value;
}

function resolveChoices(
  choices: ChatChoice[] | ((slots: RequirementSlots) => ChatChoice[]) | undefined,
  slots: RequirementSlots,
): ChatChoice[] | undefined {
  if (!choices) return undefined;
  return typeof choices === "function" ? choices(slots) : choices;
}

function findMissingSlot(slots: RequirementSlots) {
  return NEXT_QUESTIONS.find((q) => {
    if (q.when && !q.when(slots)) return false;
    // Only `null` means "still unanswered" -- an empty array (e.g.
    // integrations: []) is a valid, deliberate "nothing more" answer and
    // must not re-trigger the question forever.
    return slots[q.slot] === null;
  });
}

const ARRAY_SLOTS = new Set<keyof RequirementSlots>(["audience", "features", "integrations", "pages"]);

function splitFreeText(text: string): string[] {
  return text
    .split(/,|\band\b/i)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function matchChoice(text: string, choices?: ChatChoice[]): string | null {
  if (!choices?.length) return null;
  const lower = text.trim().toLowerCase();
  const exact = choices.find((c) => c.value.toLowerCase() === lower || c.label.toLowerCase() === lower);
  if (exact) return exact.value;
  const partial = choices.find((c) => lower.includes(c.label.toLowerCase()) || lower.includes(c.value.toLowerCase()));
  return partial?.value ?? null;
}

/**
 * Direct-input fallback (bug fix, see image.png): the curated keyword tables
 * and the AI extractor both only recognize vocabulary they know about. A
 * niche but perfectly clear answer -- "patients" for a clinic's audience --
 * matches neither, so the slot stayed `null` and `findMissingSlot` re-asked
 * the exact same question every turn no matter what the user typed.
 *
 * `text` here is always the user's direct reply to `slotKey`'s own question
 * (the caller only invokes this for the slot that was actually pending), so
 * once heuristics/AI have had their turn, take the raw answer at face value
 * instead of leaving the slot stuck forever.
 */
function applyDirectAnswer(
  slotKey: keyof RequirementSlots,
  text: string,
  choices: ChatChoice[] | undefined,
  updated: RequirementSlots,
): RequirementSlots {
  if (updated[slotKey] !== null) return updated; // heuristics or AI already filled it this turn
  const trimmed = text.trim();
  if (!trimmed) return updated;

  const choiceMatch = matchChoice(trimmed, choices);

  if (ARRAY_SLOTS.has(slotKey)) {
    const value = choiceMatch ? [choiceMatch] : splitFreeText(trimmed);
    return value.length ? { ...updated, [slotKey]: value } : updated;
  }

  return { ...updated, [slotKey]: choiceMatch ?? trimmed.toLowerCase() };
}

/**
 * "Use AI for asking questions, not generic ones": once AI is available,
 * don't just recite NEXT_QUESTIONS verbatim -- ask the model to phrase the
 * same missing detail as a specific, natural follow-up given what's already
 * known about the site. Falls back to the static question on any failure.
 */
async function aiTailorQuestion(
  slotKey: keyof RequirementSlots,
  fallbackQuestion: string,
  slots: RequirementSlots,
): Promise<string> {
  const reply = await completeText({
    maxTokens: 80,
    system:
      "You are the requirement-gathering module of an AI WordPress website builder, mid-conversation " +
      "with a user about the site they want. You need exactly one more detail from them: " +
      `"${slotKey}". Ask ONE short, natural, specific follow-up question for it -- tailored to what ` +
      "you already know about their site below, not a generic one-size-fits-all question. " +
      "No preamble, no quotes, no numbering, just the question itself. " +
      "Known so far: " + JSON.stringify(slots),
    prompt: fallbackQuestion,
  });
  const trimmed = reply?.trim().replace(/^["']|["']$/g, "");
  return trimmed || fallbackQuestion;
}

export async function runRequirementTurn(
  userText: string,
  slots: RequirementSlots,
): Promise<RequirementTurnResult> {
  // Captured before this turn's extraction runs: whichever question the
  // assistant last asked is the one `userText` is answering.
  const pending = findMissingSlot(slots);

  let updated = heuristicExtract(userText, slots);
  let ackReply: string | null = null;

  if (aiAvailable()) {
    const ai = await aiExtract(userText, slots);
    if (ai) {
      updated = {
        websiteType: updated.websiteType ?? ai.websiteType ?? null,
        audience: updated.audience ?? ai.audience ?? null,
        pages: updated.pages ?? ai.pages ?? null,
        features: Array.from(new Set([...(updated.features ?? []), ...(ai.features ?? [])])) || null,
        visualStyle: updated.visualStyle ?? ai.visualStyle ?? null,
        colorPreference: updated.colorPreference ?? ai.colorPreference ?? null,
        ecommercePayment: updated.ecommercePayment ?? ai.ecommercePayment ?? null,
        seo: updated.seo ?? ai.seo ?? null,
        accessibility: updated.accessibility ?? ai.accessibility ?? null,
        integrations: updated.integrations ?? ai.integrations ?? null,
        discoveredSkills: updated.discoveredSkills,
      };
      ackReply = ai.reply ?? null;
    }
  }

  // Live skill-pack discovery: only worth a WordPress.org lookup when the
  // curated FEATURE_KEYWORDS vocabulary found nothing this turn -- a message
  // that already resolves to a known feature (e.g. "booking") should keep
  // using the trusted, offline FEATURE_PLUGIN_MAP path, not a live search.
  if (skillDiscoveryEnabled() && detectFromKeywords(userText, FEATURE_KEYWORDS).length === 0) {
    const mention = extractSkillMention(userText);
    if (mention) {
      const known = new Set((updated.discoveredSkills ?? []).map((s) => s.slug));
      const skill = await discoverSkillPlugin(mention);
      if (skill && !known.has(skill.slug)) {
        updated = { ...updated, discoveredSkills: [...(updated.discoveredSkills ?? []), skill] };
        const note = `Found a "${skill.name}" plugin (WordPress.org) for ${mention}.`;
        ackReply = ackReply ? `${ackReply} ${note}` : note;
      }
    }
  }

  // The user's message is a direct answer to `pending`'s question -- if
  // neither the keyword heuristics nor the AI extractor above recognized it
  // (e.g. "patients" isn't in any audience keyword list), take it at face
  // value instead of leaving that slot `null` and re-asking the same
  // question forever.
  if (pending) {
    updated = applyDirectAnswer(pending.slot, userText, resolveChoices(pending.choices, updated), updated);
  }

  const missing = findMissingSlot(updated);
  if (!missing) {
    return {
      slots: updated,
      reply:
        ackReply ??
        "I have everything I need. Here's the requirements summary -- let me know if anything looks off, or say \"continue\" to see theme recommendations.",
      specReady: true,
    };
  }

  let questionText = resolveText(missing.question, updated);
  if (aiAvailable()) {
    questionText = await aiTailorQuestion(missing.slot, questionText, updated);
  }
  const reply = ackReply ? `${ackReply} ${questionText}` : questionText;
  return { slots: updated, reply, choices: resolveChoices(missing.choices, updated), specReady: false };
}

export function buildSiteSpecification(name: string, slots: RequirementSlots): SiteSpecification {
  const pages = new Set(computeBasePages(slots));
  (slots.pages ?? []).forEach((p) => pages.add(p));

  return {
    site: {
      name,
      type: slots.websiteType ?? "business",
      industry: slots.websiteType ?? "general",
      audience: slots.audience ?? ["general public"],
    },
    pages: Array.from(pages),
    features: slots.features?.filter((f) => f !== "none") ?? [],
    // GEN-10: full design-system bundle from the curated presets --
    // heuristic here (this function stays synchronous; routes/messages.ts
    // upgrades it with an AI-informed pick once the spec is ready) but
    // never just "primary color + one font" any more. See designSystem.ts.
    design: (() => {
      const style = slots.visualStyle ?? "minimal";
      const mode: "light" | "dark" = style === "futuristic" || slots.colorPreference === "dark" ? "dark" : "light";
      const primary_color = slots.colorPreference ? COLOR_MAP[slots.colorPreference] ?? "#3651D4" : "#3651D4";
      const system = heuristicDesignSystem(style, slots.websiteType ?? "business", primary_color, mode);
      return { style, mode, primary_color, ...system };
    })(),
    theme: { selected: null, use_child_theme: true },
    ecommerce: { payment: slots.ecommercePayment },
    seo: Boolean(slots.seo),
    accessibility: Boolean(slots.accessibility),
    integrations: slots.integrations ?? [],
    discoveredSkills: slots.discoveredSkills ?? [],
  };
}
