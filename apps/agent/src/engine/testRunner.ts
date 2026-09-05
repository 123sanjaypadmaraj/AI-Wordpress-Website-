import type { Project } from "@ai-wp/shared";

/**
 * TST-01/TST-02: the pipeline's own smoke suite, run automatically during
 * the TESTING state. Uses the same Playwright/Chromium dependency as the
 * screenshot tool (tools/screenshot.ts) and the standalone suite under
 * tests/e2e (which covers the same checklist for CI / manual runs against
 * an already-running project -- see tests/e2e/site.spec.ts).
 *
 * Checklist (spec section 31's minimum bar):
 *  - homepage returns 200 and renders
 *  - primary navigation links resolve
 *  - at least a sanity check for form presence on pages that should have one
 *  - no uncaught browser console/page errors
 */

export interface TestFinding {
  level: "info" | "warn" | "error";
  message: string;
}

export interface TestRunResult {
  passed: boolean;
  findings: TestFinding[];
}

export async function runSmokeSuite(project: Project): Promise<TestRunResult> {
  if (!project.docker.previewUrl) {
    return { passed: false, findings: [{ level: "error", message: "No live preview URL to test against" }] };
  }

  const { chromium } = await import("playwright");
  const findings: TestFinding[] = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const homeResp = await page.goto(project.docker.previewUrl, { waitUntil: "load", timeout: 20_000 });
    if (!homeResp || !homeResp.ok()) {
      findings.push({ level: "error", message: `Homepage returned ${homeResp?.status() ?? "no response"}` });
    } else {
      findings.push({ level: "info", message: "Homepage loads (200 OK)" });
    }

    const navLinks = await page
      .locator("nav a, header a")
      .evaluateAll((els) => Array.from(new Set(els.map((e) => (e as HTMLAnchorElement).href))))
      .catch(() => [] as string[]);
    const checked = navLinks.slice(0, 12);
    let brokenLinks = 0;
    for (const link of checked) {
      try {
        const resp = await page.request.get(link, { timeout: 8000 });
        if (!resp.ok()) brokenLinks += 1;
      } catch {
        brokenLinks += 1;
      }
    }
    findings.push({
      level: brokenLinks > 0 ? "warn" : "info",
      message: `Checked ${checked.length} navigation link(s), ${brokenLinks} unreachable`,
    });

    const formCount = await page.locator("form").count().catch(() => 0);
    findings.push({ level: "info", message: `${formCount} form element(s) found on homepage` });

    if (consoleErrors.length) {
      findings.push({
        level: "warn",
        message: `${consoleErrors.length} browser console error(s): ${consoleErrors.slice(0, 3).join(" | ")}`,
      });
    }
    if (pageErrors.length) {
      findings.push({
        level: "error",
        message: `${pageErrors.length} uncaught page error(s): ${pageErrors.slice(0, 3).join(" | ")}`,
      });
    }

    const passed = !findings.some((f) => f.level === "error");
    return { passed, findings };
  } catch (err) {
    return {
      passed: false,
      findings: [{ level: "error", message: `Test runner failed: ${err instanceof Error ? err.message : err}` }],
    };
  } finally {
    await browser.close();
  }
}
