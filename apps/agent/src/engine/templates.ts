import type { SiteSpecification } from "@ai-wp/shared";
import type { PageCopy } from "./copywriter.js";

/**
 * GEN-03/GEN-04: section-level page templates built from a small reusable
 * component library of Gutenberg block generators. Every function here
 * returns raw block HTML (the same format `wp post create/update
 * --post_content=` already accepts) -- composing a page is just picking
 * which sections apply to that page type and joining their output.
 */

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- Component library (GEN-04) -------------------------------------------

export function heroSection(headline: string, subhead: string, ctaLabel?: string): string {
  const cta = ctaLabel
    ? `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button">${esc(
        ctaLabel,
      )}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->`
    : "";
  return [
    `<!-- wp:group {"className":"section-hero"} --><div class="wp-block-group section-hero">`,
    `<!-- wp:heading {"level":1} --><h1>${esc(headline)}</h1><!-- /wp:heading -->`,
    `<!-- wp:paragraph {"className":"is-style-large"} --><p class="is-style-large">${esc(subhead)}</p><!-- /wp:paragraph -->`,
    cta,
    `</div><!-- /wp:group -->`,
  ].join("");
}

export function featureCard(title: string, body: string): string {
  return [
    `<!-- wp:group {"className":"feature-card"} --><div class="wp-block-group feature-card">`,
    `<!-- wp:heading {"level":3} --><h3>${esc(title)}</h3><!-- /wp:heading -->`,
    `<!-- wp:paragraph --><p>${esc(body)}</p><!-- /wp:paragraph -->`,
    `</div><!-- /wp:group -->`,
  ].join("");
}

export function featuresGrid(heading: string, cards: Array<{ title: string; body: string }>): string {
  return [
    `<!-- wp:group {"className":"section-features"} --><div class="wp-block-group section-features">`,
    `<!-- wp:heading {"level":2} --><h2>${esc(heading)}</h2><!-- /wp:heading -->`,
    `<!-- wp:columns --><div class="wp-block-columns">`,
    cards
      .map((c) => `<!-- wp:column --><div class="wp-block-column">${featureCard(c.title, c.body)}</div><!-- /wp:column -->`)
      .join(""),
    `</div><!-- /wp:columns -->`,
    `</div><!-- /wp:group -->`,
  ].join("");
}

export function statBlock(value: string, label: string): string {
  return `<!-- wp:column --><div class="wp-block-column stat-block"><!-- wp:heading {"level":2} --><h2>${esc(
    value,
  )}</h2><!-- /wp:heading --><!-- wp:paragraph --><p>${esc(label)}</p><!-- /wp:paragraph --></div><!-- /wp:column -->`;
}

export function statsSection(stats: Array<{ value: string; label: string }>): string {
  return [
    `<!-- wp:group {"className":"section-stats"} --><div class="wp-block-group section-stats">`,
    `<!-- wp:columns --><div class="wp-block-columns">`,
    stats.map((s) => statBlock(s.value, s.label)).join(""),
    `</div><!-- /wp:columns -->`,
    `</div><!-- /wp:group -->`,
  ].join("");
}

export function ctaSection(headline: string, buttonLabel: string): string {
  return [
    `<!-- wp:group {"className":"section-cta"} --><div class="wp-block-group section-cta">`,
    `<!-- wp:heading {"level":2} --><h2>${esc(headline)}</h2><!-- /wp:heading -->`,
    `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button">${esc(
      buttonLabel,
    )}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->`,
    `</div><!-- /wp:group -->`,
  ].join("");
}

export function testimonial(quote: string, author: string): string {
  return [
    `<!-- wp:quote --><blockquote class="wp-block-quote">`,
    `<!-- wp:paragraph --><p>${esc(quote)}</p><!-- /wp:paragraph -->`,
    `<cite>${esc(author)}</cite>`,
    `</blockquote><!-- /wp:quote -->`,
  ].join("");
}

export function pricingTable(tiers: Array<{ name: string; price: string; features: string[] }>): string {
  return [
    `<!-- wp:columns --><div class="wp-block-columns">`,
    tiers
      .map(
        (t) => `<!-- wp:column --><div class="wp-block-column pricing-tier">` +
          `<!-- wp:heading {"level":3} --><h3>${esc(t.name)}</h3><!-- /wp:heading -->` +
          `<!-- wp:paragraph {"className":"is-style-large"} --><p class="is-style-large">${esc(t.price)}</p><!-- /wp:paragraph -->` +
          `<!-- wp:list --><ul>${t.features.map((f) => `<!-- wp:list-item --><li>${esc(f)}</li><!-- /wp:list-item -->`).join("")}</ul><!-- /wp:list -->` +
          `</div><!-- /wp:column -->`,
      )
      .join(""),
    `</div><!-- /wp:columns -->`,
  ].join("");
}

export function teamGrid(members: Array<{ name: string; role: string }>): string {
  return [
    `<!-- wp:columns --><div class="wp-block-columns">`,
    members
      .map(
        (m) => `<!-- wp:column --><div class="wp-block-column team-member">` +
          `<!-- wp:heading {"level":4} --><h4>${esc(m.name)}</h4><!-- /wp:heading -->` +
          `<!-- wp:paragraph --><p>${esc(m.role)}</p><!-- /wp:paragraph -->` +
          `</div><!-- /wp:column -->`,
      )
      .join(""),
    `</div><!-- /wp:columns -->`,
  ].join("");
}

export function contactFormPlaceholder(hasContactFormPlugin: boolean): string {
  const body = hasContactFormPlugin
    ? `<!-- wp:shortcode -->[contact-form-7]<!-- /wp:shortcode -->`
    : `<!-- wp:paragraph --><p>Add a contact form once a form plugin is installed.</p><!-- /wp:paragraph -->`;
  return `<!-- wp:group {"className":"section-contact"} --><div class="wp-block-group section-contact">${body}</div><!-- /wp:group -->`;
}

export function plainSection(paragraphs: string[]): string {
  return paragraphs.map((p) => `<!-- wp:paragraph --><p>${esc(p)}</p><!-- /wp:paragraph -->`).join("");
}

// ---- Page composition (GEN-03) --------------------------------------------

/**
 * Picks which sections belong on a given page slug and stitches them
 * together with the AI-authored (or heuristic-templated) copy from
 * copywriter.ts. Unknown/custom page slugs fall back to a single generated
 * paragraph so the pipeline never has a page type it can't render.
 */
export function buildPageContent(
  pageSlug: string,
  spec: SiteSpecification,
  copy: PageCopy,
  opts: { hasContactFormPlugin: boolean },
): string {
  switch (pageSlug) {
    case "home":
      return [
        heroSection(copy.headline, copy.subhead, copy.cta ?? "Get started"),
        featuresGrid(
          "What we offer",
          copy.features.map((f) => ({ title: f.title, body: f.body })),
        ),
        spec.features.length > 0
          ? statsSection([
              { value: spec.pages.length.toString(), label: "Pages generated" },
              { value: spec.features.length.toString(), label: "Features enabled" },
              { value: "100%", label: "AI-built from your spec" },
            ])
          : "",
        ctaSection(copy.ctaHeadline ?? `Ready to work with ${spec.site.name}?`, copy.cta ?? "Contact us"),
      ].join("");
    case "about":
      return [heroSection(copy.headline, copy.subhead), plainSection(copy.body)].join("");
    case "contact":
      return [heroSection(copy.headline, copy.subhead), contactFormPlaceholder(opts.hasContactFormPlugin)].join("");
    case "team":
      return [
        heroSection(copy.headline, copy.subhead),
        teamGrid(spec.site.audience.length ? spec.site.audience.map((a) => ({ name: a, role: "Team" })) : [{ name: "Your team", role: "Add team members here" }]),
      ].join("");
    case "pricing":
      return [
        heroSection(copy.headline, copy.subhead),
        pricingTable([
          { name: "Starter", price: "$0", features: ["Core features", "Community support"] },
          { name: "Pro", price: "$29/mo", features: ["Everything in Starter", "Priority support"] },
          { name: "Enterprise", price: "Contact us", features: ["Custom terms", "Dedicated support"] },
        ]),
      ].join("");
    case "testimonials":
      return [heroSection(copy.headline, copy.subhead), testimonial("This team delivered exactly what we needed.", "A happy customer")].join("");
    default:
      return [heroSection(copy.headline, copy.subhead), plainSection(copy.body)].join("");
  }
}
