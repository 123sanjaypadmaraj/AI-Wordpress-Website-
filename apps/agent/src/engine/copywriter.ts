import Anthropic from "@anthropic-ai/sdk";
import type { SiteSpecification } from "@ai-wp/shared";

/**
 * GEN-05: AI copywriting for headlines, body copy, and CTAs.
 *
 * Same two-mode pattern as engine/requirements.ts (spec section 51): a
 * deterministic heuristic writer with zero external dependency, upgraded to
 * Claude-authored copy automatically when ANTHROPIC_API_KEY is set. The
 * page templates in engine/templates.ts don't know or care which mode
 * produced the copy they're rendering.
 */

export interface PageCopy {
  headline: string;
  subhead: string;
  body: string[];
  features: Array<{ title: string; body: string }>;
  cta?: string;
  ctaHeadline?: string;
}

function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
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
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      system:
        "You write concise, professional website copy for a WordPress page generator. " +
        "Reply with JSON only, matching exactly: " +
        '{"headline": string, "subhead": string, "body": string[] (1-3 short paragraphs), ' +
        '"features": [{"title": string, "body": string}] (exactly 3), "cta"?: string, "ctaHeadline"?: string}. ' +
        "No prose before or after the JSON.",
      messages: [
        {
          role: "user",
          content: `Write copy for the "${pageSlug}" page of a ${spec.design.style || "modern"} ${spec.site.type || "business"} website called "${spec.site.name}". Audience: ${spec.site.audience.join(", ") || "general public"}. Features offered: ${spec.features.join(", ") || "general services"}.`,
        },
      ],
    });
    const block = response.content.find((c) => c.type === "text");
    if (!block || block.type !== "text") return null;
    const match = block.text.match(/\{[\s\S]*\}/);
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
    return null; // fall back to heuristic copy on any API/parse error
  }
}

export async function generateCopy(pageSlug: string, spec: SiteSpecification): Promise<PageCopy> {
  if (aiAvailable()) {
    const ai = await aiCopy(pageSlug, spec);
    if (ai) return ai;
  }
  return heuristicCopy(pageSlug, spec);
}
