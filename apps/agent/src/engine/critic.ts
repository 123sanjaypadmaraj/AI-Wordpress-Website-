import { readFileSync } from "node:fs";
import type { Project } from "@ai-wp/shared";
import { aiAvailable, completeVision } from "../llm/client.js";
import { captureScreenshot } from "../tools/screenshot.js";

/**
 * TST-04: AI visual critic loop -- screenshot -> inspect -> (bounded) fix ->
 * re-render. Heuristic-only when no AI provider key is set (a suspiciously
 * small screenshot usually means a blank page), upgraded to an actual vision
 * critique (Claude, Gemini, or Groq -- see llm/client.ts) when one is
 * available. The loop is intentionally bounded to one auto-fix attempt (see
 * orchestrator.ts's VISUAL_REVIEW step) -- this is a safety net for the AI's
 * own output, not an open-ended retry that could loop forever against a page
 * that's fine but merely unusual.
 */

export interface CriticResult {
  issues: string[];
  screenshotPath: string | null;
  looksBlank: boolean;
}

const BLANK_PAGE_BYTES_THRESHOLD = 8000;

export async function runVisualCritic(project: Project): Promise<CriticResult> {
  let screenshot;
  try {
    screenshot = await captureScreenshot(project, "/");
  } catch (err) {
    return {
      issues: [`Could not capture a screenshot to review: ${err instanceof Error ? err.message : err}`],
      screenshotPath: null,
      looksBlank: false,
    };
  }

  const looksBlank = screenshot.bytes < BLANK_PAGE_BYTES_THRESHOLD;
  const heuristicIssues: string[] = looksBlank
    ? ["Homepage screenshot is unusually small -- the page may be rendering blank or nearly empty."]
    : [];

  if (!aiAvailable()) {
    return { issues: heuristicIssues, screenshotPath: screenshot.relativePath, looksBlank };
  }

  const imageBase64 = readFileSync(screenshot.file).toString("base64");
  const reply = await completeVision({
    maxTokens: 400,
    mediaType: "image/png",
    imageBase64,
    prompt:
      "This is a screenshot of a freshly AI-generated WordPress homepage. List at most 3 concrete, " +
      "visible issues (broken layout, illegible/overlapping text, obviously blank sections, missing " +
      "imagery where a placeholder is expected). Reply with a JSON array of short strings only -- " +
      "an empty array [] if it looks acceptable. No prose before or after the JSON.",
  });
  if (reply) {
    try {
      const match = reply.match(/\[[\s\S]*\]/);
      if (match) {
        const aiIssues = JSON.parse(match[0]) as string[];
        return { issues: [...heuristicIssues, ...aiIssues], screenshotPath: screenshot.relativePath, looksBlank };
      }
    } catch {
      // fall through to heuristic-only result below
    }
  }
  return { issues: heuristicIssues, screenshotPath: screenshot.relativePath, looksBlank };
}
