import { describe, it, expect } from "vitest";
import { emptySiteSpecification } from "@ai-wp/shared";
import type { SiteSpecification } from "@ai-wp/shared";
import {
  heroSection,
  featureCard,
  featuresGrid,
  statBlock,
  statsSection,
  ctaSection,
  testimonial,
  testimonialsGrid,
  pricingTable,
  teamGrid,
  contactFormPlaceholder,
  plainSection,
  faqSection,
  mediaGrid,
  listingSection,
  blogListing,
  woocommerceSection,
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
  buildPageContent,
} from "../../../../apps/agent/src/engine/templates.js";
import type { PageCopy } from "../../../../apps/agent/src/engine/copywriter.js";

/** Number of non-overlapping occurrences of `needle` in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function spec(overrides: Partial<SiteSpecification> = {}): SiteSpecification {
  return { ...emptySiteSpecification("Acme Co"), ...overrides };
}

const basicCopy: PageCopy = {
  headline: "Welcome",
  subhead: "A great subhead",
  body: ["First paragraph.", "Second paragraph."],
  features: [
    { title: "Fast", body: "Very fast." },
    { title: "Reliable", body: "Very reliable." },
  ],
  cta: "Get started",
  ctaHeadline: "Ready?",
};

describe("engine/templates.ts", () => {
  describe("heroSection", () => {
    it("renders headline, subhead, and CTA buttons when given all fields", () => {
      const html = heroSection("Build sites fast", "The best way to launch", "Sign up", "New");
      expect(html).toContain("<h1>Build sites fast</h1>");
      expect(html).toContain('<p class="is-style-large">The best way to launch</p>');
      expect(html).toContain(">Sign up<");
      expect(html).toContain(">Learn more<");
      expect(html).toContain('class="hero-eyebrow"');
      expect(html).toContain("New");
      // balanced group wrapper
      expect(occurrences(html, "<!-- wp:group")).toBe(1);
      expect(occurrences(html, "<!-- /wp:group -->")).toBe(1);
    });

    it("omits the CTA buttons block entirely when no ctaLabel is given", () => {
      const html = heroSection("Headline", "Subhead");
      expect(html).not.toContain("wp:buttons");
      expect(html).not.toContain(">Learn more<");
    });

    it("omits the eyebrow paragraph when none is given", () => {
      const html = heroSection("Headline", "Subhead", "CTA");
      expect(html).not.toContain("hero-eyebrow");
    });

    it("escapes HTML-significant characters in every field", () => {
      const html = heroSection('<b>Bold</b> & "quoted"', "Sub <script>", "Click & go", "A & B");
      expect(html).not.toContain("<b>Bold</b>");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
      expect(html).toContain("&amp;");
      expect(html).toContain("Click &amp; go");
    });
  });

  describe("featureCard", () => {
    it("renders the title and body and an icon", () => {
      const html = featureCard("Speed", "It is fast.");
      expect(html).toContain("<h3>Speed</h3>");
      expect(html).toContain("<p>It is fast.</p>");
      expect(html).toContain("feature-card-icon");
    });

    it("cycles through the icon set deterministically by index", () => {
      const first = featureCard("A", "a", 0);
      const wrapped = featureCard("A", "a", 6); // FEATURE_ICONS has 6 entries -> wraps to index 0
      const iconOf = (html: string) => html.match(/feature-card-icon[^>]*>([^<]*)</)?.[1];
      expect(iconOf(first)).toBe(iconOf(wrapped));
    });

    it("escapes title/body", () => {
      const html = featureCard("<x>", "a & b");
      expect(html).toContain("&lt;x&gt;");
      expect(html).toContain("a &amp; b");
    });
  });

  describe("featuresGrid", () => {
    it("renders a heading, optional subhead, and one column per card", () => {
      const html = featuresGrid(
        "What we offer",
        [
          { title: "One", body: "First" },
          { title: "Two", body: "Second" },
          { title: "Three", body: "Third" },
        ],
        "Made for you",
      );
      expect(html).toContain("<h2>What we offer</h2>");
      expect(html).toContain("section-subhead");
      expect(html).toContain("Made for you");
      expect(occurrences(html, "<!-- wp:column -->")).toBe(3);
      expect(html.indexOf("One")).toBeLessThan(html.indexOf("Two"));
      expect(html.indexOf("Two")).toBeLessThan(html.indexOf("Three"));
    });

    it("handles zero cards and a missing subhead gracefully", () => {
      const html = featuresGrid("Empty section", []);
      expect(html).toContain("<h2>Empty section</h2>");
      expect(html).not.toContain("section-subhead");
      expect(occurrences(html, "<!-- wp:column -->")).toBe(0);
      // still a well-formed wrapper
      expect(html).toContain("<!-- wp:columns -->");
      expect(html).toContain("<!-- /wp:columns -->");
    });
  });

  describe("statBlock / statsSection", () => {
    it("renders a value/label pair", () => {
      const html = statBlock("42", "Projects shipped");
      expect(html).toContain("<h2>42</h2>");
      expect(html).toContain("<p>Projects shipped</p>");
    });

    it("renders one stat column per entry, in order", () => {
      const html = statsSection([
        { value: "10", label: "Pages" },
        { value: "5", label: "Features" },
      ]);
      expect(occurrences(html, "stat-block")).toBe(2);
      expect(html.indexOf("Pages")).toBeLessThan(html.indexOf("Features"));
    });

    it("handles an empty stats array without breaking the wrapper", () => {
      const html = statsSection([]);
      expect(html).toContain("section-stats");
      expect(occurrences(html, "stat-block")).toBe(0);
    });
  });

  describe("ctaSection", () => {
    it("renders headline, button label, and optional supporting text", () => {
      const html = ctaSection("Ready to grow?", "Contact us", "We reply within a day.");
      expect(html).toContain("<h2>Ready to grow?</h2>");
      expect(html).toContain(">Contact us<");
      expect(html).toContain("We reply within a day.");
    });

    it("omits the supporting-text paragraph when not given", () => {
      const html = ctaSection("Ready?", "Go");
      expect(occurrences(html, "<!-- wp:paragraph {\"className\":\"is-style-large\"} -->")).toBe(0);
    });
  });

  describe("testimonial / testimonialsGrid", () => {
    it("renders quote, author initials, and role when given", () => {
      const html = testimonial("Great service", "Jane Doe", "CEO");
      expect(html).toContain("Great service");
      expect(html).toContain("Jane Doe");
      expect(html).toContain("CEO");
      expect(html).toContain(">JD<"); // initials()
    });

    it("omits the role span when no role is given", () => {
      const html = testimonial("Great", "Solo");
      expect(html).not.toContain("testimonial-role");
      expect(html).toContain(">S<"); // single-word name -> single initial
    });

    it("renders one column per testimonial", () => {
      const html = testimonialsGrid([
        { quote: "A", author: "Ann" },
        { quote: "B", author: "Ben", role: "Manager" },
      ]);
      // "testimonial-card" appears twice per item: once in the block comment's
      // className attribute, once as the rendered blockquote's class.
      expect(occurrences(html, "testimonial-card")).toBe(4);
    });
  });

  describe("pricingTable", () => {
    it("renders every tier's name, price, and feature list", () => {
      const html = pricingTable([
        { name: "Starter", price: "$0", features: ["A", "B"] },
        { name: "Pro", price: "$29/mo", features: ["A", "B", "C"], highlight: true },
      ]);
      expect(html).toContain("<h3>Starter</h3>");
      expect(html).toContain("<h3>Pro</h3>");
      expect(html).toContain("$0");
      expect(html).toContain("$29/mo");
      expect(occurrences(html, "<!-- wp:list-item --><li>A</li>")).toBe(2);
    });

    it("marks only the highlighted tier as most-popular", () => {
      const html = pricingTable([
        { name: "Starter", price: "$0", features: [] },
        { name: "Pro", price: "$29", features: [], highlight: true },
      ]);
      expect(occurrences(html, "Most popular")).toBe(1);
      expect(occurrences(html, "pricing-tier-highlight")).toBe(1);
    });

    it("handles a tier with an empty feature list", () => {
      const html = pricingTable([{ name: "Free", price: "$0", features: [] }]);
      expect(html).toContain("<h3>Free</h3>");
      expect(html).toContain("<!-- wp:list --><ul></ul><!-- /wp:list -->");
    });
  });

  describe("teamGrid", () => {
    it("renders name, role, and initials for each member", () => {
      const html = teamGrid([{ name: "Jane Doe", role: "Founder" }]);
      expect(html).toContain("<h4>Jane Doe</h4>");
      expect(html).toContain("Founder");
      expect(html).toContain(">JD<");
    });

    it("handles a single-word name (one initial only)", () => {
      const html = teamGrid([{ name: "Cher", role: "Singer" }]);
      expect(html).toContain(">C<");
    });
  });

  describe("contactFormPlaceholder", () => {
    it("renders the CF7 shortcode with the given form id", () => {
      const html = contactFormPlaceholder(42);
      expect(html).toContain('[contact-form-7 id="42"]');
    });

    it("falls back to a plain placeholder paragraph when id is null", () => {
      const html = contactFormPlaceholder(null);
      expect(html).not.toContain("contact-form-7");
      expect(html).toContain("Add a contact form");
    });
  });

  describe("plainSection", () => {
    it("renders one paragraph per string, escaped", () => {
      const html = plainSection(["Hello & welcome", "<b>bold</b>"]);
      expect(occurrences(html, "<!-- wp:paragraph -->")).toBe(2);
      expect(html).toContain("Hello &amp; welcome");
      expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    });

    it("handles an empty paragraph list", () => {
      const html = plainSection([]);
      expect(html).toContain("section-plain");
      expect(occurrences(html, "<!-- wp:paragraph -->")).toBe(0);
    });
  });

  describe("faqSection", () => {
    it("renders a details/summary pair per item", () => {
      const html = faqSection([
        { question: "What is this?", answer: "A generated site." },
        { question: "How much?", answer: "See pricing." },
      ]);
      expect(occurrences(html, "<summary>")).toBe(2);
      expect(html).toContain("<summary>What is this?</summary>");
      expect(html).toContain("A generated site.");
    });
  });

  describe("mediaGrid", () => {
    it("renders a caption when given and omits it otherwise", () => {
      const html = mediaGrid([{ label: "Image 1", caption: "A photo" }, { label: "Image 2" }]);
      expect(html).toContain("Image 1");
      expect(html).toContain("A photo");
      expect(html).toContain("Image 2");
      // once in the block comment's className attribute, once as the <p> class.
      expect(occurrences(html, "gallery-caption")).toBe(2);
    });

    it("cycles gallery tile classes for more than 4 items without erroring", () => {
      const items = Array.from({ length: 6 }, (_, i) => ({ label: `Img ${i}` }));
      const html = mediaGrid(items);
      expect(html).toContain("gallery-tile-0");
      expect(html).toContain("gallery-tile-1");
      // 6th item (index 5) wraps back to tile-1
      expect(occurrences(html, "gallery-item")).toBe(6);
    });
  });

  describe("listingSection", () => {
    it("renders title/meta/body and an optional tag", () => {
      const html = listingSection(
        [{ title: "Signature Dish", meta: "$18", body: "Tasty.", tag: "Popular" }],
        "section-menu",
      );
      expect(html).toContain("section-menu");
      expect(html).toContain("Signature Dish");
      expect(html).toContain("$18");
      expect(html).toContain("listing-tag");
      expect(html).toContain("Popular");
    });

    it("omits the tag span when not given", () => {
      const html = listingSection([{ title: "Event", meta: "TBD", body: "Details." }], "section-events");
      expect(html).not.toContain("listing-tag");
    });
  });

  describe("blogListing", () => {
    it("renders a query loop with post-template, no-results, and pagination", () => {
      const html = blogListing();
      expect(html).toContain("wp:query");
      expect(html).toContain("wp:post-template");
      expect(html).toContain("wp:query-no-results");
      expect(html).toContain("wp:query-pagination");
      expect(html).toContain("No posts yet");
    });
  });

  describe("woocommerceSection", () => {
    it("renders the real shortcode when active", () => {
      const html = woocommerceSection("woocommerce_cart", "fallback", true);
      expect(html).toContain("[woocommerce_cart]");
      expect(html).not.toContain("fallback");
    });

    it("renders the fallback text when not active, without emitting a broken shortcode", () => {
      const html = woocommerceSection("woocommerce_cart", "Your cart will appear here.", false);
      expect(html).not.toContain("wp:shortcode");
      expect(html).toContain("Your cart will appear here.");
    });
  });

  describe("placeholder* generators", () => {
    it("placeholderTeam returns one generic member per role", () => {
      const team = placeholderTeam();
      expect(team.length).toBeGreaterThan(0);
      expect(team[0]).toEqual({ name: "Team Member 1", role: "Founder" });
    });

    it("placeholderTestimonials references the site name and cycles the audience", () => {
      const s = spec({ site: { ...emptySiteSpecification().site, name: "Acme", audience: ["renters", "landlords"] } });
      const items = placeholderTestimonials(s);
      expect(items.length).toBe(3);
      expect(items[0].quote).toContain("Acme");
      expect(items[0].role).toBe("renters");
      expect(items[1].role).toBe("landlords");
    });

    it("placeholderTestimonials falls back to a generic audience when none is set", () => {
      const items = placeholderTestimonials(spec());
      expect(items[0].role).toBe("our customers");
    });

    it("placeholderFaqs adds a payments question only when ecommerce is a feature", () => {
      const without = placeholderFaqs(spec());
      const withEcom = placeholderFaqs(spec({ features: ["ecommerce"] }));
      expect(without.some((f) => /payment methods/i.test(f.question))).toBe(false);
      expect(withEcom.some((f) => /payment methods/i.test(f.question))).toBe(true);
    });

    it("placeholderGalleryItems generates the requested count with a labeled prefix", () => {
      const items = placeholderGalleryItems(3, "Project");
      expect(items).toHaveLength(3);
      expect(items[0].label).toBe("Image 1");
      expect(items[0].caption).toContain("Project 1");
    });

    it("placeholderCaseStudies/Jobs/Events/Menu/PricingTiers/MembershipTiers return non-empty, plausible shapes", () => {
      expect(placeholderCaseStudies(spec()).length).toBeGreaterThan(0);
      expect(placeholderJobs(spec()).every((j) => j.title && j.body)).toBe(true);
      expect(placeholderEvents().every((e) => e.tag === "Upcoming")).toBe(true);
      expect(placeholderMenu().every((m) => m.meta.startsWith("$"))).toBe(true);
      expect(placeholderPricingTiers().some((t) => t.highlight)).toBe(true);
      expect(placeholderMembershipTiers().some((t) => t.highlight)).toBe(true);
    });
  });

  describe("buildPageContent (full page composition)", () => {
    it("assembles the home page as hero -> features -> bonus sections, in order", () => {
      const s = spec({ features: ["ecommerce", "blog"] });
      const html = buildPageContent("home", s, basicCopy, { contactFormId: null });
      const heroIdx = html.indexOf("<h1>Welcome</h1>");
      const featuresIdx = html.indexOf("What we offer");
      expect(heroIdx).toBeGreaterThanOrEqual(0);
      expect(featuresIdx).toBeGreaterThan(heroIdx);
    });

    it("renders bonus sections in the exact order the layout plan specifies", () => {
      const s = spec();
      const html = buildPageContent("home", s, basicCopy, {
        contactFormId: null,
        layout: { bonus: ["cta", "stats"] },
      });
      const ctaIdx = html.indexOf("section-cta");
      const statsIdx = html.indexOf("section-stats");
      expect(ctaIdx).toBeGreaterThanOrEqual(0);
      expect(statsIdx).toBeGreaterThan(ctaIdx);
    });

    it("uses provided supporting content for bonus sections that need it, and renders nothing when it's missing", () => {
      const s = spec();
      const withContent = buildPageContent("home", s, basicCopy, {
        contactFormId: null,
        layout: { bonus: ["testimonials"] },
        content: { testimonials: [{ quote: "Great!", author: "Sam" }] },
      });
      expect(withContent).toContain("Great!");

      const withoutContent = buildPageContent("home", s, basicCopy, {
        contactFormId: null,
        layout: { bonus: ["testimonials"] },
      });
      expect(withoutContent).not.toContain("section-testimonials");
    });

    it("renders the pricing page with a provided pricing table or the placeholder tiers", () => {
      const s = spec();
      const html = buildPageContent("pricing", s, basicCopy, {
        contactFormId: null,
        content: { pricingTiers: [{ name: "Custom", price: "$99", features: ["X"] }] },
      });
      expect(html).toContain("Custom");
      expect(html).toContain("$99");

      const fallback = buildPageContent("pricing", s, basicCopy, { contactFormId: null });
      expect(fallback).toContain("Starter"); // placeholderPricingTiers()
    });

    it("renders contact page with a real form id or the fallback placeholder", () => {
      const s = spec();
      expect(buildPageContent("contact", s, basicCopy, { contactFormId: 7 })).toContain('id="7"');
      expect(buildPageContent("contact", s, basicCopy, { contactFormId: null })).toContain("Add a contact form");
    });

    it("renders shop/cart/checkout with WooCommerce shortcodes only when hasWooCommerce is true", () => {
      const s = spec();
      const active = buildPageContent("shop", s, basicCopy, { contactFormId: null, hasWooCommerce: true });
      const inactive = buildPageContent("shop", s, basicCopy, { contactFormId: null, hasWooCommerce: false });
      expect(active).toContain("wp:shortcode");
      expect(inactive).not.toContain("wp:shortcode");
      expect(inactive).toContain("will appear here");
    });

    it("falls back to hero + plain body copy for an unrecognized page slug", () => {
      const s = spec();
      const html = buildPageContent("some-custom-page", s, basicCopy, { contactFormId: null });
      expect(html).toContain("<h1>Welcome</h1>");
      expect(html).toContain("First paragraph.");
      expect(html).toContain("Second paragraph.");
    });

    it("defaults to a conservative heuristic layout plan when no layout is passed at all", () => {
      // No opts.layout given -- buildPageContent must fall back to
      // heuristicLayoutPlan() itself rather than skipping bonus composition.
      const s = spec({ features: ["ecommerce"] });
      const html = buildPageContent("home", s, basicCopy, { contactFormId: null });
      expect(html).toContain("section-stats"); // spec.features.length > 0 -> heuristic adds "stats"
      expect(html).toContain("section-cta"); // heuristic always appends a closing cta on home
    });
  });
});
