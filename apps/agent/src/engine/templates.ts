import type { SiteSpecification } from "@ai-wp/shared";
import type { PageCopy } from "./copywriter.js";
import type { SupportingContent } from "./contentGenerator.js";
import { heuristicLayoutPlan, type BonusSection, type PageLayoutPlan } from "./layout.js";

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

/** Deterministic short "avatar" initials from a name, for testimonial/team cards that have no photo. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// ---- Component library (GEN-04) -------------------------------------------

export function heroSection(headline: string, subhead: string, ctaLabel?: string, eyebrow?: string): string {
  const eyebrowHtml = eyebrow
    ? `<!-- wp:paragraph {"className":"hero-eyebrow"} --><p class="hero-eyebrow">${esc(eyebrow)}</p><!-- /wp:paragraph -->`
    : "";
  const cta = ctaLabel
    ? [
        `<!-- wp:buttons --><div class="wp-block-buttons">`,
        `<!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button">${esc(
          ctaLabel,
        )}</a></div><!-- /wp:button -->`,
        `<!-- wp:button {"className":"is-style-outline"} --><div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button">Learn more</a></div><!-- /wp:button -->`,
        `</div><!-- /wp:buttons -->`,
      ].join("")
    : "";
  return [
    `<!-- wp:group {"className":"section-hero"} --><div class="wp-block-group section-hero"><div class="section-hero-inner">`,
    eyebrowHtml,
    `<!-- wp:heading {"level":1} --><h1>${esc(headline)}</h1><!-- /wp:heading -->`,
    `<!-- wp:paragraph {"className":"is-style-large"} --><p class="is-style-large">${esc(subhead)}</p><!-- /wp:paragraph -->`,
    cta,
    `</div></div><!-- /wp:group -->`,
  ].join("");
}

const FEATURE_ICONS = ["✦", "◆", "✤", "❀", "◈", "✱"]; // decorative, font-rendered -- no image assets available at generation time

export function featureCard(title: string, body: string, index = 0): string {
  const icon = FEATURE_ICONS[index % FEATURE_ICONS.length];
  return [
    `<!-- wp:group {"className":"feature-card"} --><div class="wp-block-group feature-card">`,
    `<div class="feature-card-icon" aria-hidden="true">${icon}</div>`,
    `<!-- wp:heading {"level":3} --><h3>${esc(title)}</h3><!-- /wp:heading -->`,
    `<!-- wp:paragraph --><p>${esc(body)}</p><!-- /wp:paragraph -->`,
    `</div><!-- /wp:group -->`,
  ].join("");
}

export function featuresGrid(heading: string, cards: Array<{ title: string; body: string }>, subhead?: string): string {
  return [
    `<!-- wp:group {"className":"section-features"} --><div class="wp-block-group section-features">`,
    `<div class="section-heading">`,
    `<!-- wp:heading {"level":2} --><h2>${esc(heading)}</h2><!-- /wp:heading -->`,
    subhead ? `<!-- wp:paragraph {"className":"section-subhead"} --><p class="section-subhead">${esc(subhead)}</p><!-- /wp:paragraph -->` : "",
    `</div>`,
    `<!-- wp:columns --><div class="wp-block-columns">`,
    cards
      .map(
        (c, i) =>
          `<!-- wp:column --><div class="wp-block-column">${featureCard(c.title, c.body, i)}</div><!-- /wp:column -->`,
      )
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

export function ctaSection(headline: string, buttonLabel: string, supportingText?: string): string {
  return [
    `<!-- wp:group {"className":"section-cta"} --><div class="wp-block-group section-cta">`,
    `<!-- wp:heading {"level":2} --><h2>${esc(headline)}</h2><!-- /wp:heading -->`,
    supportingText
      ? `<!-- wp:paragraph {"className":"is-style-large"} --><p class="is-style-large">${esc(supportingText)}</p><!-- /wp:paragraph -->`
      : "",
    `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button">${esc(
      buttonLabel,
    )}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->`,
    `</div><!-- /wp:group -->`,
  ].join("");
}

/**
 * GEN-11: renders whichever bonus sections engine/layout.ts's plan chose,
 * in the order it chose them, after a page's own core content. `content`
 * carries whatever supporting content the plan's bonus keys asked for
 * (contentGenerator.ts's bonusContentKeys) -- a bonus section silently
 * renders nothing if that content didn't come through (e.g. a malformed AI
 * response for that field), rather than showing an empty card grid.
 */
function renderBonusSections(bonus: BonusSection[], spec: SiteSpecification, copy: PageCopy, content: SupportingContent): string {
  return bonus
    .map((section) => {
      switch (section) {
        case "features":
          return featuresGrid("What sets us apart", copy.features);
        case "stats":
          return statsSection([
            { value: spec.pages.length.toString(), label: "Pages generated" },
            { value: spec.features.length.toString(), label: "Features enabled" },
            { value: "100%", label: "AI-built from your spec" },
          ]);
        case "testimonials":
          return content.testimonials?.length ? testimonialsGrid(content.testimonials) : "";
        case "faq":
          return content.faqs?.length ? faqSection(content.faqs.slice(0, 3)) : "";
        case "cta":
          return ctaSection(copy.ctaHeadline ?? `Ready to work with ${spec.site.name}?`, copy.cta ?? "Get in touch");
        default:
          return "";
      }
    })
    .join("");
}

export function testimonial(quote: string, author: string, role?: string): string {
  return [
    `<!-- wp:column --><div class="wp-block-column">`,
    `<!-- wp:quote {"className":"testimonial-card"} --><blockquote class="wp-block-quote testimonial-card">`,
    `<!-- wp:paragraph --><p>${esc(quote)}</p><!-- /wp:paragraph -->`,
    `<div class="testimonial-attribution"><span class="testimonial-avatar" aria-hidden="true">${esc(
      initials(author),
    )}</span><cite>${esc(author)}${role ? `<span class="testimonial-role">${esc(role)}</span>` : ""}</cite></div>`,
    `</blockquote><!-- /wp:quote -->`,
    `</div><!-- /wp:column -->`,
  ].join("");
}

export function testimonialsGrid(items: Array<{ quote: string; author: string; role?: string }>): string {
  return [
    `<!-- wp:group {"className":"section-testimonials"} --><div class="wp-block-group section-testimonials">`,
    `<!-- wp:columns --><div class="wp-block-columns">`,
    items.map((t) => testimonial(t.quote, t.author, t.role)).join(""),
    `</div><!-- /wp:columns -->`,
    `</div><!-- /wp:group -->`,
  ].join("");
}

export function pricingTable(tiers: Array<{ name: string; price: string; features: string[]; highlight?: boolean }>): string {
  return [
    `<!-- wp:columns {"className":"section-pricing"} --><div class="wp-block-columns section-pricing">`,
    tiers
      .map(
        (t) =>
          `<!-- wp:column --><div class="wp-block-column pricing-tier${t.highlight ? " pricing-tier-highlight" : ""}">` +
          (t.highlight ? `<span class="pricing-badge">Most popular</span>` : "") +
          `<!-- wp:heading {"level":3} --><h3>${esc(t.name)}</h3><!-- /wp:heading -->` +
          `<!-- wp:paragraph {"className":"is-style-large pricing-price"} --><p class="is-style-large pricing-price">${esc(
            t.price,
          )}</p><!-- /wp:paragraph -->` +
          `<!-- wp:list --><ul>${t.features
            .map((f) => `<!-- wp:list-item --><li>${esc(f)}</li><!-- /wp:list-item -->`)
            .join("")}</ul><!-- /wp:list -->` +
          `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button {"className":"${
            t.highlight ? "" : "is-style-outline"
          }"} --><div class="wp-block-button${t.highlight ? "" : " is-style-outline"}"><a class="wp-block-button__link wp-element-button">Choose ${esc(
            t.name,
          )}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->` +
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
        (m) =>
          `<!-- wp:column --><div class="wp-block-column team-member">` +
          `<div class="team-avatar" aria-hidden="true">${esc(initials(m.name))}</div>` +
          `<!-- wp:heading {"level":4} --><h4>${esc(m.name)}</h4><!-- /wp:heading -->` +
          `<!-- wp:paragraph {"className":"team-role"} --><p class="team-role">${esc(m.role)}</p><!-- /wp:paragraph -->` +
          `</div><!-- /wp:column -->`,
      )
      .join(""),
    `</div><!-- /wp:columns -->`,
  ].join("");
}

/**
 * `contactFormId` is the actual post ID of the plugin's default "Contact
 * form 1" (see tools/wordpress.ts#getContactFormId) -- the CF7 shortcode
 * without an explicit id renders "Contact form not found" instead of a
 * form, so null (plugin missing, or its form couldn't be looked up) falls
 * back to a plain placeholder rather than emitting a broken shortcode.
 */
export function contactFormPlaceholder(contactFormId: number | null): string {
  const body = contactFormId
    ? `<!-- wp:shortcode -->[contact-form-7 id="${contactFormId}"]<!-- /wp:shortcode -->`
    : `<!-- wp:paragraph --><p>Add a contact form once a form plugin is installed.</p><!-- /wp:paragraph -->`;
  return `<!-- wp:group {"className":"section-contact"} --><div class="wp-block-group section-contact">${body}</div><!-- /wp:group -->`;
}

export function plainSection(paragraphs: string[]): string {
  return [
    `<!-- wp:group {"className":"section-plain"} --><div class="wp-block-group section-plain">`,
    paragraphs.map((p) => `<!-- wp:paragraph --><p>${esc(p)}</p><!-- /wp:paragraph -->`).join(""),
    `</div><!-- /wp:group -->`,
  ].join("");
}

/**
 * Accordion Q&A using the core `details` block (native `<details>/<summary>`
 * -- collapsible with zero JS, and screen-reader friendly out of the box).
 */
export function faqSection(items: Array<{ question: string; answer: string }>): string {
  return [
    `<!-- wp:group {"className":"section-faq"} --><div class="wp-block-group section-faq">`,
    items
      .map(
        (item) =>
          `<!-- wp:details {"showContent":false,"className":"faq-item"} --><details class="wp-block-details faq-item">` +
          `<summary>${esc(item.question)}</summary>` +
          `<!-- wp:paragraph --><p>${esc(item.answer)}</p><!-- /wp:paragraph -->` +
          `</details><!-- /wp:details -->`,
      )
      .join(""),
    `</div><!-- /wp:group -->`,
  ].join("");
}

/**
 * Placeholder image grid for a gallery/projects/portfolio page. No real
 * image assets exist at generation time, so each tile is a labelled
 * gradient placeholder rather than a broken `<img>` -- same "clearly
 * generic, obviously replaceable" spirit as the other placeholder content
 * below, made visual instead of textual.
 */
export function mediaGrid(items: Array<{ label: string; caption?: string }>): string {
  return [
    `<!-- wp:group {"className":"section-gallery"} --><div class="wp-block-group section-gallery">`,
    `<!-- wp:columns --><div class="wp-block-columns">`,
    items
      .map(
        (item, i) =>
          `<!-- wp:column --><div class="wp-block-column gallery-item">` +
          `<div class="gallery-tile gallery-tile-${i % 4}" aria-hidden="true"><span>${esc(item.label)}</span></div>` +
          (item.caption
            ? `<!-- wp:paragraph {"className":"gallery-caption"} --><p class="gallery-caption">${esc(item.caption)}</p><!-- /wp:paragraph -->`
            : "") +
          `</div><!-- /wp:column -->`,
      )
      .join(""),
    `</div><!-- /wp:columns -->`,
    `</div><!-- /wp:group -->`,
  ].join("");
}

/** Shared "dated/tagged list" layout behind events, careers, and the restaurant menu. */
export function listingSection(
  items: Array<{ title: string; meta: string; body: string; tag?: string }>,
  className: string,
): string {
  return [
    `<!-- wp:group {"className":"${className}"} --><div class="wp-block-group ${className}">`,
    items
      .map(
        (item) =>
          `<!-- wp:group {"className":"listing-item"} --><div class="wp-block-group listing-item">` +
          `<div class="listing-item-header">` +
          `<!-- wp:heading {"level":3} --><h3>${esc(item.title)}</h3><!-- /wp:heading -->` +
          (item.tag ? `<span class="listing-tag">${esc(item.tag)}</span>` : "") +
          `</div>` +
          `<!-- wp:paragraph {"className":"listing-meta"} --><p class="listing-meta">${esc(item.meta)}</p><!-- /wp:paragraph -->` +
          `<!-- wp:paragraph --><p>${esc(item.body)}</p><!-- /wp:paragraph -->` +
          `</div><!-- /wp:group -->`,
      )
      .join(""),
    `</div><!-- /wp:group -->`,
  ].join("");
}

/**
 * Live "latest posts" listing via the core Query Loop block -- unlike the
 * other page templates here this isn't placeholder copy at all, it's a real
 * dynamic block that renders actual published posts (and WordPress's own
 * `query-no-results` block covers the empty state before any exist).
 */
export function blogListing(): string {
  return [
    `<!-- wp:query {"queryId":1,"query":{"perPage":6,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","inherit":false},"className":"section-blog"} --><div class="wp-block-query section-blog">`,
    `<!-- wp:post-template --><!-- wp:post-title {"isLink":true} /--><!-- wp:post-date /--><!-- wp:post-excerpt /--><!-- /wp:post-template -->`,
    `<!-- wp:query-no-results --><!-- wp:paragraph --><p>No posts yet -- published posts will appear here automatically.</p><!-- /wp:paragraph --><!-- /wp:query-no-results -->`,
    `<!-- wp:query-pagination --><!-- wp:query-pagination-previous /--><!-- wp:query-pagination-numbers /--><!-- wp:query-pagination-next /--><!-- /wp:query-pagination -->`,
    `</div><!-- /wp:query -->`,
  ].join("");
}

/**
 * WooCommerce's own shortcodes ([products]/[woocommerce_cart]/
 * [woocommerce_checkout]) render the real, functional catalog/cart/checkout
 * -- used only when the plugin is actually installed, since the shortcode
 * renders a "shortcode not found" style notice otherwise, same reasoning as
 * `contactFormPlaceholder` above.
 */
export function woocommerceSection(shortcode: string, fallbackText: string, active: boolean): string {
  const body = active
    ? `<!-- wp:shortcode -->[${shortcode}]<!-- /wp:shortcode -->`
    : `<!-- wp:paragraph --><p>${esc(fallbackText)}</p><!-- /wp:paragraph -->`;
  return `<!-- wp:group {"className":"section-shop"} --><div class="wp-block-group section-shop">${body}</div><!-- /wp:group -->`;
}

// ---- Placeholder content generators ----------------------------------------
// These never claim real facts (no invented customer names, counts, or
// awards) -- they're clearly-generic scaffolding the site owner is expected
// to replace, same spirit as the "Replace this generated placeholder..."
// copy already used on the about page.

const GENERIC_TEAM_ROLES = ["Founder", "Operations Lead", "Product Lead", "Customer Success"];

export function placeholderTeam(): Array<{ name: string; role: string }> {
  return GENERIC_TEAM_ROLES.map((role, i) => ({ name: `Team Member ${i + 1}`, role }));
}

export function placeholderTestimonials(spec: SiteSpecification): Array<{ quote: string; author: string; role?: string }> {
  const name = spec.site.name;
  const audiences = spec.site.audience.length ? spec.site.audience : ["our customers"];
  const roleFor = (i: number) => audiences[i % audiences.length];
  return [
    {
      quote: `${name} made this so much easier than we expected -- exactly what we needed.`,
      author: "Sample Customer",
      role: roleFor(0),
    },
    {
      quote: `The team was responsive and the results spoke for themselves.`,
      author: "Sample Customer",
      role: roleFor(1),
    },
    {
      quote: `Would recommend ${name} to anyone looking for a straightforward, reliable experience.`,
      author: "Sample Customer",
      role: roleFor(2),
    },
  ];
}

export function placeholderFaqs(spec: SiteSpecification): Array<{ question: string; answer: string }> {
  const name = spec.site.name;
  const faqs = [
    { question: `What does ${name} offer?`, answer: `Replace this with a real answer covering what ${name} does for ${spec.site.audience[0] || "customers"}.` },
    { question: "How do I get started?", answer: "Reach out via the contact page and we'll walk you through the next steps." },
    { question: "What are your prices?", answer: "See the pricing page for current plans, or contact us for a custom quote." },
  ];
  if (spec.features.includes("ecommerce")) {
    faqs.push({ question: "What payment methods do you accept?", answer: "We accept all major cards and other checkout options configured in the store." });
  }
  return faqs;
}

export function placeholderGalleryItems(count: number, labelPrefix: string): Array<{ label: string; caption?: string }> {
  return Array.from({ length: count }, (_, i) => ({
    label: `Image ${i + 1}`,
    caption: `${labelPrefix} ${i + 1} -- replace with a real photo.`,
  }));
}

export function placeholderCaseStudies(spec: SiteSpecification): Array<{ title: string; body: string }> {
  const audiences = spec.site.audience.length ? spec.site.audience : ["a client"];
  return [0, 1, 2].map((i) => ({
    title: `Project ${String.fromCharCode(65 + i)}`,
    body: `A sample case study for ${audiences[i % audiences.length]} -- replace with a real project, the problem it solved, and the outcome.`,
  }));
}

export function placeholderJobs(spec: SiteSpecification): Array<{ title: string; meta: string; body: string; tag: string }> {
  return [
    { title: "Open Role 1", meta: `${spec.site.name} · Full-time · Remote`, body: "Replace with a real job description once you have an opening to list.", tag: "Hiring" },
    { title: "Open Role 2", meta: `${spec.site.name} · Part-time · On-site`, body: "Replace with a real job description once you have an opening to list.", tag: "Hiring" },
  ];
}

export function placeholderEvents(): Array<{ title: string; meta: string; body: string; tag: string }> {
  return [
    { title: "Upcoming Event 1", meta: "Date & time to be announced", body: "Replace with your next event's details once it's scheduled.", tag: "Upcoming" },
    { title: "Upcoming Event 2", meta: "Date & time to be announced", body: "Replace with your next event's details once it's scheduled.", tag: "Upcoming" },
  ];
}

export function placeholderMenu(): Array<{ title: string; meta: string; body: string }> {
  return [
    { title: "Signature Dish", meta: "$18", body: "A short, appetizing description of this dish goes here." },
    { title: "House Favorite", meta: "$14", body: "A short, appetizing description of this dish goes here." },
    { title: "Seasonal Special", meta: "$22", body: "A short, appetizing description of this dish goes here." },
  ];
}

export function placeholderPricingTiers(): Array<{ name: string; price: string; features: string[]; highlight?: boolean }> {
  return [
    { name: "Starter", price: "$0", features: ["Core features", "Community support"] },
    { name: "Pro", price: "$29/mo", features: ["Everything in Starter", "Priority support"], highlight: true },
    { name: "Enterprise", price: "Contact us", features: ["Custom terms", "Dedicated support"] },
  ];
}

export function placeholderMembershipTiers(): Array<{ name: string; price: string; features: string[]; highlight?: boolean }> {
  return [
    { name: "Individual", price: "$10/mo", features: ["Full member access", "Newsletter"] },
    { name: "Family", price: "$18/mo", features: ["Everything in Individual", "Up to 4 members"], highlight: true },
    { name: "Student", price: "$5/mo", features: ["Full member access", "Valid ID required"] },
  ];
}

// ---- Page composition (GEN-03) --------------------------------------------

/**
 * Picks which sections belong on a given page slug and stitches them
 * together with the AI-authored (or heuristic-templated) copy from
 * copywriter.ts. Unknown/custom page slugs fall back to a single generated
 * paragraph so the pipeline never has a page type it can't render.
 *
 * Each page's own core content (what makes a "pricing" page a pricing page)
 * is still fixed here, same as always -- GEN-11's layout plan only controls
 * which *optional* bonus sections (see renderBonusSections above) get
 * appended after it, and in what order, for the page slugs eligible for any
 * (engine/layout.ts's ELIGIBLE_BONUS).
 */
export function buildPageContent(
  pageSlug: string,
  spec: SiteSpecification,
  copy: PageCopy,
  opts: { contactFormId: number | null; hasWooCommerce?: boolean; content?: SupportingContent; layout?: PageLayoutPlan },
): string {
  const hasWooCommerce = opts.hasWooCommerce ?? false;
  const content = opts.content ?? {};
  // GEN-11: callers that plan ahead (orchestrator.ts, incremental.ts) pass
  // an AI-or-heuristic layout plan already resolved for this page; anything
  // that doesn't (an older call site, a direct test) still gets the exact
  // same conservative heuristic plan planPageLayout() would fall back to --
  // buildPageContent itself never silently skips section composition.
  const layout = opts.layout ?? heuristicLayoutPlan(pageSlug, spec);
  switch (pageSlug) {
    case "home":
      return [
        heroSection(copy.headline, copy.subhead, copy.cta ?? "Get started", spec.site.industry || spec.site.type || undefined),
        featuresGrid(
          "What we offer",
          copy.features.map((f) => ({ title: f.title, body: f.body })),
          `Built around what ${spec.site.audience[0] || "you"} actually need.`,
        ),
        renderBonusSections(layout.bonus, spec, copy, content),
      ].join("");
    case "about":
      return [heroSection(copy.headline, copy.subhead), plainSection(copy.body), renderBonusSections(layout.bonus, spec, copy, content)].join("");
    case "contact":
      return [heroSection(copy.headline, copy.subhead), contactFormPlaceholder(opts.contactFormId)].join("");
    case "team":
      return [heroSection(copy.headline, copy.subhead), teamGrid(content.team ?? placeholderTeam())].join("");
    case "pricing":
      return [
        heroSection(copy.headline, copy.subhead),
        pricingTable(content.pricingTiers ?? placeholderPricingTiers()),
      ].join("");
    case "testimonials":
      return [heroSection(copy.headline, copy.subhead), testimonialsGrid(content.testimonials ?? placeholderTestimonials(spec))].join("");
    case "faq":
      return [heroSection(copy.headline, copy.subhead), faqSection(content.faqs ?? placeholderFaqs(spec))].join("");
    case "gallery":
    case "projects":
      return [
        heroSection(copy.headline, copy.subhead),
        mediaGrid(content.galleryItems ?? placeholderGalleryItems(6, pageSlug === "projects" ? "Project" : "Photo")),
      ].join("");
    case "case-studies":
      return [
        heroSection(copy.headline, copy.subhead),
        featuresGrid("Recent work", content.caseStudies ?? placeholderCaseStudies(spec)),
        renderBonusSections(layout.bonus, spec, copy, content),
      ].join("");
    case "careers":
      return [
        heroSection(copy.headline, copy.subhead),
        listingSection(content.jobs ?? placeholderJobs(spec), "section-careers"),
        ctaSection(`Don't see the right role?`, "Get in touch", `We're always happy to hear from people who want to work with ${spec.site.name}.`),
      ].join("");
    case "events":
      return [heroSection(copy.headline, copy.subhead), listingSection(content.events ?? placeholderEvents(), "section-events")].join("");
    case "menu":
      return [heroSection(copy.headline, copy.subhead), listingSection(content.menuItems ?? placeholderMenu(), "section-menu")].join("");
    case "reservations":
    case "booking":
      return [
        heroSection(copy.headline, copy.subhead),
        plainSection([`Use the form below to request a reservation and we'll confirm by email or phone.`]),
        contactFormPlaceholder(opts.contactFormId),
      ].join("");
    case "donate":
      return [
        heroSection(copy.headline, copy.subhead),
        statsSection([
          { value: "100%", label: "Goes toward our mission" },
          { value: spec.site.audience.length.toString() || "1", label: "Communities served" },
        ]),
        ctaSection(copy.ctaHeadline ?? `Support ${spec.site.name}`, copy.cta ?? "Donate now"),
      ].join("");
    case "programs":
    case "services":
      return [
        heroSection(copy.headline, copy.subhead),
        featuresGrid(pageSlug === "services" ? "Our services" : "Our programs", copy.features),
        renderBonusSections(layout.bonus, spec, copy, content),
      ].join("");
    case "members":
      return [
        heroSection(copy.headline, copy.subhead),
        pricingTable(content.membershipTiers ?? placeholderMembershipTiers()),
        featuresGrid("Member benefits", copy.features),
        renderBonusSections(layout.bonus, spec, copy, content),
      ].join("");
    case "blog":
      return [heroSection(copy.headline, copy.subhead), blogListing()].join("");
    case "shop":
      return [
        heroSection(copy.headline, copy.subhead),
        woocommerceSection(
          "products limit=\"6\" columns=\"3\"",
          "Products will appear here once they're added in WooCommerce.",
          hasWooCommerce,
        ),
      ].join("");
    case "cart":
      return [
        heroSection(copy.headline, copy.subhead),
        woocommerceSection("woocommerce_cart", "Your cart will appear here once a store is configured.", hasWooCommerce),
      ].join("");
    case "checkout":
      return [
        heroSection(copy.headline, copy.subhead),
        woocommerceSection("woocommerce_checkout", "Checkout will appear here once a store is configured.", hasWooCommerce),
      ].join("");
    case "product":
      return [
        heroSection(copy.headline, copy.subhead),
        plainSection([
          hasWooCommerce
            ? "Individual products are managed from the WooCommerce catalog and get their own page automatically once added."
            : "Add products once a store plugin (WooCommerce) is installed.",
        ]),
      ].join("");
    default:
      return [heroSection(copy.headline, copy.subhead), plainSection(copy.body)].join("");
  }
}
