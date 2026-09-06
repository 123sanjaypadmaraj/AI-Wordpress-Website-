import type { SiteSpecification } from "@ai-wp/shared";
import { aiAvailable, completeText } from "../llm/client.js";

/**
 * GEN-05: AI copywriting for headlines, body copy, and CTAs.
 *
 * Same two-mode pattern as engine/requirements.ts (spec section 51): a
 * deterministic heuristic writer with zero external dependency, upgraded to
 * AI-authored copy automatically when an API key is set for any supported
 * provider (see llm/client.ts). The page templates in engine/templates.ts
 * don't know or care which mode -- or which provider -- produced the copy
 * they're rendering.
 */

export interface PageCopy {
  headline: string;
  subhead: string;
  body: string[];
  features: Array<{ title: string; body: string }>;
  cta?: string;
  ctaHeadline?: string;
}

function titleCase(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");
}

function heuristicCopy(pageSlug: string, spec: SiteSpecification): PageCopy {
  const name = spec.site.name;
  const type = spec.site.type || "site";
  const audience = spec.site.audience.join(", ") || "everyone";

  const featureCopy = (spec.features.length ? spec.features : ["quality", "reliability", "support"]).slice(0, 3).map((f) => ({
    title: titleCase(f),
    body: `${titleCase(f)} built into ${name}, tailored for ${audience}.`,
  }));

  switch (pageSlug) {
    case "home":
      return {
        headline: `${name}`,
        subhead: `A ${spec.design.style || "modern"} ${type} site for ${audience}, generated from your requirements.`,
        body: [`Welcome to ${name}.`],
        features: featureCopy,
        cta: "Get started",
        ctaHeadline: `Ready to work with ${name}?`,
      };
    case "about":
      return {
        headline: `About ${name}`,
        subhead: `Here's what ${name} is about.`,
        body: [
          `${name} is a ${type} built for ${audience}.`,
          "Replace this generated placeholder with your own story once you're ready.",
        ],
        features: featureCopy,
      };
    case "contact":
      return {
        headline: "Get in touch",
        subhead: `We'd love to hear from you.`,
        body: [`Reach out to ${name} using the form below.`],
        features: featureCopy,
      };
    case "faq":
      return {
        headline: "Frequently asked questions",
        subhead: `Answers to what ${audience} usually ask ${name} first.`,
        body: [`Common questions about ${name}, answered.`],
        features: featureCopy,
      };
    case "careers":
      return {
        headline: `Work with us`,
        subhead: `Join the team behind ${name}.`,
        body: [`Open roles at ${name} will be listed here.`],
        features: featureCopy,
      };
    case "blog":
      return {
        headline: "Blog",
        subhead: `News and updates from ${name}.`,
        body: [`Recent posts from ${name}.`],
        features: featureCopy,
      };
    case "shop":
      return {
        headline: "Shop",
        subhead: `Browse what ${name} has to offer.`,
        body: [`Products from ${name}.`],
        features: featureCopy,
      };
    case "donate":
      return {
        headline: `Support ${name}`,
        subhead: `Your gift goes directly toward our work for ${audience}.`,
        body: [`Here's how your support helps ${name}.`],
        features: featureCopy,
        cta: "Donate now",
      };
    case "events":
      return {
        headline: "Events",
        subhead: `What's coming up at ${name}.`,
        body: [`Upcoming events hosted by ${name}.`],
        features: featureCopy,
      };
    case "menu":
      return {
        headline: "Menu",
        subhead: `What's on offer at ${name}.`,
        body: [`Dishes served at ${name}.`],
        features: featureCopy,
      };
    case "reservations":
    case "booking":
      return {
        headline: "Book a table",
        subhead: `Reserve your spot at ${name}.`,
        body: [`Let ${name} know when you're coming.`],
        features: featureCopy,
      };
    case "gallery":
    case "projects":
      return {
        headline: pageSlug === "projects" ? "Our projects" : "Gallery",
        subhead: `A look at ${name}'s work.`,
        body: [`Recent work from ${name}.`],
        features: featureCopy,
      };
    case "case-studies":
      return {
        headline: "Case studies",
        subhead: `Real results ${name} has delivered for ${audience}.`,
        body: [`Selected work from ${name}.`],
        features: featureCopy,
      };
    case "services":
    case "programs":
      return {
        headline: pageSlug === "services" ? "Our services" : "Our programs",
        subhead: `What ${name} offers ${audience}.`,
        body: [`${titleCase(pageSlug)} run by ${name}.`],
        features: featureCopy,
      };
    case "members":
      return {
        headline: "Membership",
        subhead: `Join ${name} and become part of ${audience}.`,
        body: [`Membership options for ${name}.`],
        features: featureCopy,
      };
    default:
      return {
        headline: titleCase(pageSlug),
        subhead: `${titleCase(pageSlug)} page for ${name}.`,
        body: [`This ${titleCase(pageSlug).toLowerCase()} page was generated from your site specification.`],
        features: featureCopy,
      };
  }
}

interface AiCopyResponse {
  headline?: string;
  subhead?: string;
  body?: string[];
  features?: Array<{ title: string; body: string }>;
  cta?: string;
  ctaHeadline?: string;
}

async function aiCopy(pageSlug: string, spec: SiteSpecification): Promise<PageCopy | null> {
  const reply = await completeText({
    maxTokens: 600,
    system:
      "You write concise, professional website copy for a WordPress page generator. " +
      "Reply with JSON only, matching exactly: " +
      '{"headline": string, "subhead": string, "body": string[] (1-3 short paragraphs), ' +
      '"features": [{"title": string, "body": string}] (exactly 3), "cta"?: string, "ctaHeadline"?: string}. ' +
      "No prose before or after the JSON.",
    prompt: `Write copy for the "${pageSlug}" page of a ${spec.design.style || "modern"} ${spec.site.type || "business"} website called "${spec.site.name}". Audience: ${spec.site.audience.join(", ") || "general public"}. Features offered: ${spec.features.join(", ") || "general services"}.`,
  });
  if (!reply) return null;
  try {
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as AiCopyResponse;
    if (!parsed.headline || !parsed.subhead) return null;
    return {
      headline: parsed.headline,
      subhead: parsed.subhead,
      body: parsed.body?.length ? parsed.body : [parsed.subhead],
      features: parsed.features?.length ? parsed.features : heuristicCopy(pageSlug, spec).features,
      cta: parsed.cta,
      ctaHeadline: parsed.ctaHeadline,
    };
  } catch {
    return null; // fall back to heuristic copy on any parse error
  }
}

export async function generateCopy(pageSlug: string, spec: SiteSpecification): Promise<PageCopy> {
  if (aiAvailable()) {
    const ai = await aiCopy(pageSlug, spec);
    if (ai) return ai;
  }
  return heuristicCopy(pageSlug, spec);
}

// ---------------------------------------------------------------------------
// CMS-01: AI-assisted rewrite of one page's existing content, driven by a
// free-form instruction from the content editor ("make this shorter", "add a
// paragraph about our warranty"). Unlike generateCopy() above there's no
// sensible offline heuristic for an arbitrary instruction, so this is
// AI-only and returns null when no provider is configured -- the route
// surfaces that honestly rather than silently no-op'ing or guessing.
// ---------------------------------------------------------------------------

export interface PageContentDraft {
  title: string;
  content: string;
}

export async function rewritePageContent(params: {
  siteName: string;
  pageTitle: string;
  currentContent: string;
  instruction: string;
}): Promise<PageContentDraft | null> {
  if (!aiAvailable()) return null;
  const reply = await completeText({
    maxTokens: 1800,
    system:
      "You edit WordPress page content for a website builder. The content is Gutenberg block HTML " +
      "(plain HTML interleaved with <!-- wp:... --> block comments). Apply the requested change to the " +
      "wording/copy while preserving the existing block structure and HTML tags -- only restructure blocks " +
      "if the instruction explicitly asks for it. Reply with JSON only, matching exactly: " +
      '{"title": string, "content": string}. No prose before or after the JSON, no markdown fences.',
    prompt:
      `Site: "${params.siteName}". Current page title: "${params.pageTitle}".\n\n` +
      `Current content (Gutenberg block HTML):\n${params.currentContent}\n\n` +
      `Instruction: ${params.instruction}`,
  });
  if (!reply) return null;
  try {
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { title?: string; content?: string };
    if (!parsed.content) return null;
    return { title: parsed.title || params.pageTitle, content: parsed.content };
  } catch {
    return null; // malformed AI reply -- caller treats this the same as "AI unavailable"
  }
}
