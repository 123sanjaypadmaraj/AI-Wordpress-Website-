import Anthropic from "@anthropic-ai/sdk";
import type { ChatChoice, RequirementSlots, SiteSpecification } from "@ai-wp/shared";

/**
 * Requirement-gathering agent (spec section 7).
 *
 * Two modes:
 *  - Heuristic (default, no API key required): keyword-based slot filling.
 *    Deterministic and fully offline, so `npm run dev` works with zero setup.
 *  - AI-assisted (ANTHROPIC_API_KEY set): asks Claude to extract slots from
 *    free-form text as JSON. Same slot shape either way, so nothing
 *    downstream (spec builder, theme engine) needs to know which mode ran.
 *
 * Either way the agent never re-asks a question a slot already answers --
 * that statefulness is the point of section 51 (AI agent memory).
 */

function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

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
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 512,
      system:
        "You are the requirement-gathering module of an AI WordPress website builder. " +
        "Extract website requirements from the user's message as JSON only, matching this " +
        "TypeScript type exactly, with no prose before or after: " +
        '{"websiteType"?: string, "audience"?: string[], "features"?: string[], ' +
        '"visualStyle"?: string, "colorPreference"?: string, "ecommercePayment"?: string, ' +
        '"seo"?: boolean, "accessibility"?: boolean, "integrations"?: string[], "reply"?: string}. ' +
        "Only include fields you are confident about. `reply` is one short, friendly " +
        "sentence acknowledging what you understood. Known slots so far: " +
        JSON.stringify(slots),
      messages: [{ role: "user", content: text }],
    });
    const block = response.content.find((c) => c.type === "text");
    if (!block || block.type !== "text") return null;
    const match = block.text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as AiExtraction;
  } catch {
    return null; // fall back to heuristics on any API/parse error
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
  question: string;
  choices?: ChatChoice[];
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
    question: "Do you need any of these: event registration, a project showcase, a blog, or online payments?",
    choices: [
      { label: "Event registration", value: "event-registration" },
      { label: "Project showcase", value: "project-showcase" },
      { label: "Blog / news", value: "blog" },
      { label: "None of these", value: "none" },
    ],
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

function findMissingSlot(slots: RequirementSlots) {
  return NEXT_QUESTIONS.find((q) => {
    if (q.when && !q.when(slots)) return false;
    // Only `null` means "still unanswered" -- an empty array (e.g.
    // integrations: []) is a valid, deliberate "nothing more" answer and
    // must not re-trigger the question forever.
    return slots[q.slot] === null;
  });
}

export async function runRequirementTurn(
  userText: string,
  slots: RequirementSlots,
): Promise<RequirementTurnResult> {
  let updated = heuristicExtract(userText, slots);
  let ackReply: string | null = null;

  if (aiAvailable()) {
    const ai = await aiExtract(userText, slots);
    if (ai) {
      updated = {
        websiteType: updated.websiteType ?? ai.websiteType ?? null,
        audience: updated.audience ?? ai.audience ?? null,
        pages: updated.pages,
        features: Array.from(new Set([...(updated.features ?? []), ...(ai.features ?? [])])) || null,
        visualStyle: updated.visualStyle ?? ai.visualStyle ?? null,
        colorPreference: updated.colorPreference ?? ai.colorPreference ?? null,
        ecommercePayment: updated.ecommercePayment ?? ai.ecommercePayment ?? null,
        seo: updated.seo ?? ai.seo ?? null,
        accessibility: updated.accessibility ?? ai.accessibility ?? null,
        integrations: updated.integrations ?? ai.integrations ?? null,
      };
      ackReply = ai.reply ?? null;
    }
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

  const reply = ackReply ? `${ackReply} ${missing.question}` : missing.question;
  return { slots: updated, reply, choices: missing.choices, specReady: false };
}

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

export function buildSiteSpecification(name: string, slots: RequirementSlots): SiteSpecification {
  const pages = new Set(DEFAULT_PAGES);
  if (slots.websiteType && TYPE_PAGES[slots.websiteType]) {
    TYPE_PAGES[slots.websiteType].forEach((p) => pages.add(p));
  }
  (slots.features ?? []).forEach((f) => {
    if (FEATURE_PAGES[f]) pages.add(FEATURE_PAGES[f]);
  });

  return {
    site: {
      name,
      type: slots.websiteType ?? "business",
      industry: slots.websiteType ?? "general",
      audience: slots.audience ?? ["general public"],
    },
    pages: Array.from(pages),
    features: slots.features?.filter((f) => f !== "none") ?? [],
    design: {
      style: slots.visualStyle ?? "minimal",
      mode: slots.visualStyle === "futuristic" || slots.colorPreference === "dark" ? "dark" : "light",
      primary_color: slots.colorPreference ? COLOR_MAP[slots.colorPreference] ?? "#3651D4" : "#3651D4",
      font: slots.visualStyle === "corporate" ? "IBM Plex Sans" : "Inter",
    },
    theme: { selected: null, use_child_theme: true },
    ecommerce: { payment: slots.ecommercePayment },
    seo: Boolean(slots.seo),
    accessibility: Boolean(slots.accessibility),
    integrations: slots.integrations ?? [],
  };
}
