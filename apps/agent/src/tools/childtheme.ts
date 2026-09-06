import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@ai-wp/shared";
import { projectDir, composeCp } from "../docker/compose.js";
import { execWpCli } from "../docker/compose.js";

/**
 * GEN-06/GEN-07: child-theme generation & activation -- how the AI-derived
 * design system (GEN-10: primary/secondary color, heading/body font pairing,
 * corner-radius personality, mode, all from spec.design) actually reaches
 * the live site, instead of just being metadata the UI displays.
 *
 * A local staging copy is kept under
 * infrastructure/docker/projects/<id>/child-theme/ (not just inside the
 * container) so EXP-01's export tool can zip real files rather than having
 * to `docker compose cp` them back out at export time.
 */

export function childThemeSlug(parentSlug: string): string {
  return `${parentSlug}-ai-child`;
}

export function childThemeStagingDir(projectId: string, slug: string) {
  return join(projectDir(projectId), "child-theme", slug);
}
const stagingDir = childThemeStagingDir;

const GOOGLE_FONT_STACKS: Record<string, string> = {
  Inter: "'Inter', ui-sans-serif, system-ui, sans-serif",
  "IBM Plex Sans": "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  Poppins: "'Poppins', ui-sans-serif, system-ui, sans-serif",
  Nunito: "'Nunito', ui-sans-serif, system-ui, sans-serif",
  "Playfair Display": "'Playfair Display', Georgia, 'Times New Roman', serif",
};

function fontStackFor(font: string): string {
  return GOOGLE_FONT_STACKS[font] ?? `'${font}', ui-sans-serif, system-ui, sans-serif`;
}

// GEN-10: the "radius" design-system axis is one personality knob applied
// to two different scales -- cards/sections read oddly at a literal pill
// radius, so only buttons/badges go all the way to a true pill; cards get a
// smaller bump that still reads as "rounder" without looking like a chip.
const RADIUS_SCALE: Record<"sharp" | "soft" | "pill", { card: string; button: string }> = {
  sharp: { card: "4px", button: "6px" },
  soft: { card: "14px", button: "10px" },
  pill: { card: "20px", button: "999px" },
};

/** Exported (in addition to being used internally below) so it can be exercised directly -- e.g. a design-preview script -- without needing a running Docker/WP-CLI stack. */
export function renderChildThemeCss(project: Project, parentSlug: string, parentName: string): string {
  const { primary_color, secondary_color, mode, heading_font, body_font, radius } = project.spec.design;
  const headingFontStack = fontStackFor(heading_font);
  const bodyFontStack = fontStackFor(body_font);
  const { card: cardRadius, button: buttonRadius } = RADIUS_SCALE[radius] ?? RADIUS_SCALE.soft;
  const bg = mode === "dark" ? "#14151C" : "#FFFFFF";
  const text = mode === "dark" ? "#E7E8F0" : "#1B1D29";
  const shadow = mode === "dark" ? "rgba(0, 0, 0, 0.45)" : "rgba(20, 21, 28, 0.08)";
  const shadowStrong = mode === "dark" ? "rgba(0, 0, 0, 0.6)" : "rgba(20, 21, 28, 0.14)";

  // NOTE: a previous version of this file only touched links/buttons/borders
  // -- on a "minimal" style with a dark/neutral accent color that produced a
  // site nearly indistinguishable from an unstyled WordPress install (GEN-06
  // bug report: "I don't see any theme actually used"). The rules below push
  // the accent color onto surfaces a viewer actually notices without
  // scrolling -- the header, the hero, section backgrounds, and card
  // treatment -- plus real depth (shadows, hover motion, rounded surfaces)
  // and a footer/nav treatment, so a generated site reads as an intentional,
  // finished product rather than an unstyled WordPress install with a
  // tinted button.
  return `/*
Theme Name: ${project.spec.site.name} (AI Child)
Template: ${parentSlug}
Description: Generated child theme (of ${parentName}) applying the AI-derived design system (GEN-06) for "${project.spec.site.name}".
Version: 1.0.${Date.now()}
*/

:root {
  --ai-primary: ${primary_color};
  --ai-primary-soft: color-mix(in srgb, ${primary_color} 12%, ${bg});
  --ai-primary-contrast: color-mix(in srgb, ${primary_color} 65%, white);
  --ai-secondary: ${secondary_color};
  --ai-secondary-soft: color-mix(in srgb, ${secondary_color} 12%, ${bg});
  --ai-surface: color-mix(in srgb, ${text} 4%, ${bg});
  --ai-surface-raised: color-mix(in srgb, ${text} 2%, ${bg});
  --ai-border: color-mix(in srgb, ${text} 14%, transparent);
  --ai-bg: ${bg};
  --ai-text: ${text};
  --ai-text-muted: color-mix(in srgb, ${text} 65%, ${bg});
  --ai-font-heading: ${headingFontStack};
  --ai-font-body: ${bodyFontStack};
  --ai-shadow: 0 1px 2px ${shadow}, 0 8px 24px -12px ${shadow};
  --ai-shadow-hover: 0 4px 8px ${shadow}, 0 16px 32px -12px ${shadowStrong};
  --ai-radius: ${cardRadius};
  --ai-radius-button: ${buttonRadius};
}

* {
  box-sizing: border-box;
}

/* Belt-and-suspenders layout for core blocks: WordPress's own
   wp-block-library stylesheet normally supplies this flex layout, but the
   child theme shouldn't silently break (buttons/columns collapsing into an
   overlapping stack) if that stylesheet is ever missing, overridden, or
   loaded after this one. */
.wp-block-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.wp-block-columns {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}

.wp-block-column {
  flex: 1 1 240px;
}

body {
  background-color: var(--ai-bg);
  color: var(--ai-text);
  font-family: var(--ai-font-body);
  line-height: 1.6;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--ai-font-heading);
  letter-spacing: -0.02em;
  line-height: 1.15;
  /* !important (matching the nav-hover rule below, same reason): Astra
     prints its own "h1..h6 { color: var(--ast-global-color-2) }" Global
     Styles rule via wp_add_inline_style, at the *same* specificity as a
     bare tag selector -- a plain "color" here can lose that tie depending
     on which handle Astra attaches it to, keeping the parent theme's
     light-mode-tuned dark navy heading color even after this rule is
     enqueued later. Without a forced win here, headings go unreadable
     against a dark-mode design system's dark hero/CTA bands, since only
     body/p text was ever wired to --ai-text. */
  color: var(--ai-text) !important;
}

p {
  color: var(--ai-text-muted);
}

a {
  color: var(--ai-primary);
}

a:focus-visible, button:focus-visible, .wp-block-button__link:focus-visible {
  outline: 2px solid var(--ai-primary);
  outline-offset: 2px;
}

.wp-block-button__link, .wp-element-button {
  background-color: var(--ai-primary);
  color: #fff;
  border-radius: var(--ai-radius-button);
  padding: 0.75em 1.5em;
  font-weight: 600;
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  box-shadow: var(--ai-shadow);
}

.wp-block-button__link:hover, .wp-element-button:hover {
  opacity: 0.92;
  transform: translateY(-1px);
  box-shadow: var(--ai-shadow-hover);
}

.wp-block-button.is-style-outline .wp-block-button__link {
  background-color: transparent;
  color: var(--ai-text);
  border: 1.5px solid var(--ai-border);
  box-shadow: none;
}

.wp-block-button.is-style-outline .wp-block-button__link:hover {
  border-color: var(--ai-primary);
  color: var(--ai-primary);
  box-shadow: none;
}

/* Site header / nav: the very first thing a viewer sees, so the accent
   color and a settled, "designed" feel need to show up here, not just
   three sections down the page. */
.wp-site-header, header.wp-block-template-part {
  background-color: color-mix(in srgb, var(--ai-bg) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--ai-border);
  position: sticky;
  top: 0;
  z-index: 30;
}

.wp-block-site-title, .wp-block-site-title a {
  color: var(--ai-primary);
  font-weight: 700;
}

.wp-block-navigation a {
  font-family: var(--ai-font-heading);
  font-weight: 500;
}

.wp-block-navigation a:hover,
.wp-block-navigation .current-menu-item > a,
.wp-block-navigation__responsive-container-open:hover {
  color: var(--ai-primary) !important;
}

/* ---- Hero ---------------------------------------------------------- */

.section-hero {
  padding: clamp(3rem, 6vw, 6rem) 1.5rem;
  background:
    radial-gradient(60% 100% at 50% 0%, var(--ai-primary-soft), transparent),
    radial-gradient(45% 80% at 100% 0%, var(--ai-secondary-soft), transparent),
    linear-gradient(180deg, var(--ai-primary-soft), var(--ai-bg) 70%);
  border-bottom: 1px solid var(--ai-border);
  text-align: center;
}

.section-hero-inner {
  max-width: 46rem;
  margin: 0 auto;
}

.section-hero h1 {
  font-size: clamp(2rem, 4vw + 1rem, 3.25rem);
  margin-bottom: 0.75rem;
}

.section-hero .is-style-large {
  font-size: clamp(1.05rem, 1vw + 0.9rem, 1.35rem);
  color: var(--ai-text-muted);
  max-width: 38rem;
  margin: 0 auto 1.75rem;
}

.section-hero .wp-block-buttons {
  justify-content: center;
}

.hero-eyebrow {
  display: inline-block;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ai-primary);
  background-color: var(--ai-primary-soft);
  border-radius: 999px;
  padding: 0.35em 0.9em;
  margin-bottom: 1.25rem;
}

/* ---- Section rhythm & headings -------------------------------------- */

.section-features, .section-stats, .section-testimonials, .section-plain {
  padding: clamp(2.5rem, 5vw, 4.5rem) 1.5rem;
  max-width: 72rem;
  margin: 0 auto;
}

.section-heading {
  text-align: center;
  max-width: 40rem;
  margin: 0 auto 2.5rem;
}

.section-subhead {
  color: var(--ai-text-muted);
}

.section-stats {
  background-color: var(--ai-surface);
  border-radius: var(--ai-radius);
}

.section-features .wp-block-columns,
.section-stats .wp-block-columns,
.section-testimonials .wp-block-columns,
.section-pricing.wp-block-columns {
  gap: 1.75rem;
}

/* ---- Cards (features / pricing / team) ------------------------------ */

.feature-card, .pricing-tier, .team-member {
  border: 1px solid var(--ai-border);
  border-radius: var(--ai-radius);
  padding: 1.75rem;
  background-color: var(--ai-surface-raised);
  box-shadow: var(--ai-shadow);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  height: 100%;
}

.feature-card:hover, .pricing-tier:hover, .team-member:hover {
  transform: translateY(-3px);
  box-shadow: var(--ai-shadow-hover);
}

.feature-card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 8px;
  background-color: var(--ai-primary-soft);
  color: var(--ai-primary);
  font-size: 1.1rem;
  margin-bottom: 1rem;
}

/* Alternate the accent so a features grid reads as "designed with a
   palette", not one color repeated on every card. */
.wp-block-column:nth-child(even) .feature-card-icon {
  background-color: var(--ai-secondary-soft);
  color: var(--ai-secondary);
}

.stat-block {
  text-align: center;
}

.stat-block h2 {
  color: var(--ai-primary);
  font-size: clamp(1.75rem, 2vw + 1rem, 2.5rem);
  margin-bottom: 0.25rem;
}

/* ---- Testimonials ---------------------------------------------------- */

.testimonial-card {
  height: 100%;
  border: 1px solid var(--ai-border);
  border-left: none;
  border-radius: var(--ai-radius);
  padding: 1.75rem;
  background-color: var(--ai-surface-raised);
  box-shadow: var(--ai-shadow);
  margin: 0;
}

.testimonial-card p {
  color: var(--ai-text);
  font-style: normal;
}

.testimonial-card p::before {
  content: "\\201C";
  color: var(--ai-primary);
  font-size: 1.5em;
  line-height: 0;
  vertical-align: -0.35em;
  margin-right: 0.15em;
}

.testimonial-attribution {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.testimonial-avatar, .team-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  background-color: var(--ai-primary);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  flex-shrink: 0;
}

.testimonial-card cite {
  font-style: normal;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  font-size: 0.9rem;
}

.testimonial-role {
  font-weight: 400;
  color: var(--ai-text-muted);
  font-size: 0.85rem;
}

/* ---- Pricing ---------------------------------------------------------- */

.pricing-tier {
  text-align: center;
  position: relative;
  display: flex;
  flex-direction: column;
}

.pricing-tier-highlight {
  border-color: var(--ai-primary);
  border-width: 2px;
  transform: scale(1.03);
}

.pricing-badge {
  position: absolute;
  top: -0.85rem;
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--ai-primary);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.3em 0.9em;
  border-radius: 999px;
  white-space: nowrap;
}

.pricing-price {
  color: var(--ai-primary);
  font-weight: 700;
  margin-bottom: 1rem;
}

.pricing-tier ul {
  text-align: left;
  color: var(--ai-text-muted);
  margin-bottom: 1.5rem;
  flex-grow: 1;
}

.pricing-tier .wp-block-buttons {
  justify-content: center;
}

/* ---- Team --------------------------------------------------------------- */

.team-member {
  text-align: center;
}

.team-avatar {
  width: 3.5rem;
  height: 3.5rem;
  font-size: 1.1rem;
  margin: 0 auto 1rem;
}

.team-role {
  color: var(--ai-text-muted);
  font-size: 0.9rem;
}

/* ---- CTA band ------------------------------------------------------------ */

.section-cta {
  padding: clamp(2.5rem, 5vw, 4rem) 1.5rem;
  background: linear-gradient(135deg, var(--ai-primary), var(--ai-secondary));
  border-radius: var(--ai-radius);
  max-width: 72rem;
  margin: 2rem auto;
  text-align: center;
}

.section-cta h2, .section-cta p {
  color: #fff;
}

.section-cta .wp-block-button__link, .section-cta .wp-element-button {
  background-color: #fff;
  color: var(--ai-primary);
}

.section-cta .wp-block-buttons {
  justify-content: center;
}

/* ---- FAQ (details/summary accordion) ---------------------------------- */

.section-faq {
  padding: clamp(2.5rem, 5vw, 4.5rem) 1.5rem;
  max-width: 48rem;
  margin: 0 auto;
}

.faq-item {
  border: 1px solid var(--ai-border);
  border-radius: 10px;
  padding: 0.25rem 1.25rem;
  margin-bottom: 0.75rem;
  background-color: var(--ai-surface-raised);
}

.faq-item summary {
  cursor: pointer;
  font-weight: 600;
  padding: 0.9rem 0;
  list-style: none;
}

.faq-item summary::-webkit-details-marker {
  display: none;
}

.faq-item summary::after {
  content: "+";
  float: right;
  color: var(--ai-primary);
  font-weight: 700;
}

.faq-item[open] summary::after {
  content: "\\2212";
}

.faq-item p {
  padding-bottom: 1rem;
}

/* ---- Gallery / media grid ------------------------------------------------ */

.section-gallery {
  padding: clamp(2.5rem, 5vw, 4.5rem) 1.5rem;
  max-width: 72rem;
  margin: 0 auto;
}

.gallery-tile {
  aspect-ratio: 4 / 3;
  border-radius: var(--ai-radius);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
}

.gallery-tile-0 { background: linear-gradient(135deg, var(--ai-primary), color-mix(in srgb, var(--ai-primary) 55%, black)); }
.gallery-tile-1 { background: linear-gradient(135deg, var(--ai-secondary), color-mix(in srgb, var(--ai-secondary) 55%, black)); }
.gallery-tile-2 { background: linear-gradient(135deg, var(--ai-primary), var(--ai-secondary)); }
.gallery-tile-3 { background: linear-gradient(135deg, color-mix(in srgb, var(--ai-secondary) 70%, white), var(--ai-secondary)); }

.gallery-caption {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--ai-text-muted);
  text-align: center;
}

/* ---- Listings: events / careers / menu --------------------------------- */

.section-careers, .section-events, .section-menu {
  padding: clamp(2.5rem, 5vw, 4.5rem) 1.5rem;
  max-width: 56rem;
  margin: 0 auto;
}

.listing-item {
  border: 1px solid var(--ai-border);
  border-radius: var(--ai-radius);
  padding: 1.5rem 1.75rem;
  margin-bottom: 1rem;
  background-color: var(--ai-surface-raised);
  box-shadow: var(--ai-shadow);
}

.listing-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.listing-item-header h3 {
  margin: 0;
}

.listing-tag {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ai-primary);
  background-color: var(--ai-primary-soft);
  border-radius: 999px;
  padding: 0.3em 0.8em;
}

.listing-meta {
  color: var(--ai-primary);
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

/* ---- Blog (Query Loop) ---------------------------------------------------- */

.section-blog {
  padding: clamp(2.5rem, 5vw, 4.5rem) 1.5rem;
  max-width: 56rem;
  margin: 0 auto;
}

.section-blog .wp-block-post-template {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.section-blog .wp-block-post-template > li {
  border-bottom: 1px solid var(--ai-border);
  padding-bottom: 1.5rem;
}

.section-blog .wp-block-query-pagination {
  margin-top: 2rem;
  display: flex;
  justify-content: center;
  gap: 1rem;
}

/* ---- Shop (WooCommerce shortcodes) ---------------------------------------- */

.section-shop {
  padding: clamp(2.5rem, 5vw, 4.5rem) 1.5rem;
  max-width: 72rem;
  margin: 0 auto;
}

/* ---- Footer --------------------------------------------------------------- */

.wp-block-template-part[data-area="footer"], footer.wp-block-template-part {
  border-top: 1px solid var(--ai-border);
  background-color: var(--ai-surface);
  color: var(--ai-text-muted);
}

/* ---- Small screens --------------------------------------------------------- */

@media (max-width: 599px) {
  .section-hero, .section-features, .section-stats, .section-testimonials, .section-plain, .section-cta,
  .section-faq, .section-gallery, .section-careers, .section-events, .section-menu, .section-blog, .section-shop {
    padding-left: 1.25rem;
    padding-right: 1.25rem;
  }

  .pricing-tier-highlight {
    transform: none;
  }

  .listing-item-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }
}
`;
}

const CHILD_THEME_FUNCTIONS_PHP = `<?php
// Generated by the AI WordPress Builder (GEN-07). Enqueues the parent theme's
// stylesheet before this child theme's, per the standard WP child-theme
// pattern -- do not hand edit, regenerated on every design-system change.
add_action( 'wp_enqueue_scripts', function () {
    $parent = wp_get_theme()->parent();
    if ( $parent ) {
        wp_enqueue_style( 'ai-parent-style', get_template_directory_uri() . '/style.css' );
    }
    wp_enqueue_style(
        'ai-child-style',
        get_stylesheet_uri(),
        $parent ? array( 'ai-parent-style' ) : array(),
        wp_get_theme()->get( 'Version' )
    );
} );
`;

/** Writes the child theme locally, ships it into the wpcli container, and activates it. */
export async function generateAndActivateChildTheme(project: Project, parentSlug: string, parentName: string): Promise<string> {
  const slug = childThemeSlug(parentSlug);
  const dir = stagingDir(project.id, slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "style.css"), renderChildThemeCss(project, parentSlug, parentName));
  writeFileSync(join(dir, "functions.php"), CHILD_THEME_FUNCTIONS_PHP);

  // docker compose cp copies a whole directory when the source is a
  // directory -- lands at wp-content/themes/<slug>/{style.css,functions.php}.
  await composeCp(project.id, dir, `wpcli:/var/www/html/wp-content/themes/${slug}`);
  await execWpCli(project.id, ["theme", "activate", slug]);
  return slug;
}

/**
 * Re-renders just the CSS and re-ships it -- used by the incremental editor
 * (GEN-09) for design-only changes, without touching pages or plugins.
 * Also (re-)activates the child theme: a design edit is meaningless if the
 * child theme it's rewriting isn't actually the one currently serving the
 * site (e.g. a project whose child theme was generated but never
 * activated, or reactivated after a checkpoint restore). Activating an
 * already-active theme is a safe no-op.
 */
export async function regenerateChildThemeStyles(project: Project, parentSlug: string, parentName: string): Promise<void> {
  const slug = childThemeSlug(parentSlug);
  const dir = stagingDir(project.id, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "style.css"), renderChildThemeCss(project, parentSlug, parentName));
  await composeCp(project.id, join(dir, "style.css"), `wpcli:/var/www/html/wp-content/themes/${slug}/style.css`);
  await execWpCli(project.id, ["theme", "activate", slug]);
}
