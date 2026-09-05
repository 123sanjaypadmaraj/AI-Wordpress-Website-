import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@ai-wp/shared";
import { projectDir } from "../docker/compose.js";

/**
 * TST-03: screenshot capture tool. Uses Playwright's Chromium (already a
 * dependency for the TST-01 test runner) rather than shelling out to a
 * separate screenshot service -- one browser automation dependency, two
 * uses.
 */

export function screenshotDir(projectId: string) {
  return join(projectDir(projectId), "screenshots");
}

export interface ScreenshotResult {
  file: string; // absolute path
  relativePath: string; // e.g. "2026-09-05T12-00-00-000Z.png", served at /projects/:id/screenshots/:file
  bytes: number;
}

export async function captureScreenshot(project: Project, path = "/"): Promise<ScreenshotResult> {
  if (!project.docker.previewUrl) throw new Error("Project has no live preview to screenshot yet");

  // Lazy import: playwright pulls in a real browser binary, so keep it out
  // of the module graph for requests that never touch this tool.
  const { chromium } = await import("playwright");
  const dir = screenshotDir(project.id);
  mkdirSync(dir, { recursive: true });

  const relativePath = `${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const file = join(dir, relativePath);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${project.docker.previewUrl}${path}`, { waitUntil: "networkidle", timeout: 20_000 });
    const buffer = await page.screenshot({ fullPage: true });
    writeFileSync(file, buffer);
    return { file, relativePath, bytes: buffer.byteLength };
  } finally {
    await browser.close();
  }
}

export function readScreenshot(projectId: string, relativePath: string): Buffer {
  return readFileSync(join(screenshotDir(projectId), relativePath));
}
