import { test, expect } from "@playwright/test";

/**
 * TST-02: minimum test suite for a generated site -- page loads, nav
 * resolves, forms are present where expected, no console errors. Point it
 * at any generated project's preview URL:
 *
 *   PREVIEW_URL=http://localhost:8101 npm run test:e2e
 */

test.describe("generated site smoke checks", () => {
  test("homepage loads with no console or page errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const response = await page.goto("/");
    expect(response?.ok(), `homepage should return 2xx, got ${response?.status()}`).toBeTruthy();
    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join(", ")}`).toHaveLength(0);
    expect(pageErrors, `unexpected page errors: ${pageErrors.join(", ")}`).toHaveLength(0);
  });

  test("primary navigation links resolve", async ({ page, request }) => {
    await page.goto("/");
    const links = await page
      .locator("nav a, header a")
      .evaluateAll((els) => Array.from(new Set(els.map((e) => (e as HTMLAnchorElement).href))));
    expect(links.length, "expected at least one navigation link").toBeGreaterThan(0);

    for (const link of links.slice(0, 12)) {
      const resp = await request.get(link);
      expect(resp.ok(), `nav link should resolve: ${link} (${resp.status()})`).toBeTruthy();
    }
  });

  test("the site is served by WordPress", async ({ page }) => {
    await page.goto("/");
    const generator = await page.locator('meta[name="generator"]').getAttribute("content").catch(() => null);
    const footerText = await page.locator("footer").innerText().catch(() => "");
    expect(
      (generator ?? "").toLowerCase().includes("wordpress") || footerText.toLowerCase().includes("wordpress"),
      "expected a WordPress generator tag or footer credit",
    ).toBeTruthy();
  });
});
