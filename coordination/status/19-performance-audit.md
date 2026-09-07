---
state: in-progress
owner: 19-performance-audit
started: 2026-09-07T00:00:00Z
summary: Adding a Lighthouse-based performance/accessibility/SEO/best-practices audit step, run after the visual-critic step, non-fatal + bounded by a timeout, stored on the project record and surfaced in apps/web.
---

## Plan

1. `packages/shared`: add `PerformanceAuditResult` (+scores/findings shapes)
   and a `performanceAudit: PerformanceAuditResult | null` field on `Project`.
2. `apps/agent/src/engine/performanceAudit.ts`: new engine module. Launches
   Playwright's Chromium (already a dependency, same as `tools/screenshot.ts`
   and `engine/testRunner.ts`) with a remote-debugging port and runs the
   `lighthouse` npm package programmatically against it (no new browser
   binary). Extracts the 4 category scores + top findings (failing,
   non-informational audits, worst-first). Bounded by a timeout
   (`Promise.race`), and any failure (throw or timeout) is caught and
   returned as `{ error: string, scores: all-null, findings: [] }` rather
   than thrown -- never fails the pipeline.
3. `apps/agent/src/engine/orchestrator.ts`: wired in right after the existing
   visual-critic step (same try/catch-and-log-warn shape), result stored via
   `project.performanceAudit` + `store.saveProject`, not just logged.
   **Diff flagged**: this file is also owned/touched by the orchestrator
   itself for other tasks -- my change is additive-only, a new `try {}` block
   plus one new field assignment right after the VISUAL_REVIEW block, before
   `setStatus(project, "READY")`.
4. `apps/web`: new `PerformanceAuditPanel.tsx` component, mounted as a
   sibling section in the Preview tab (`BuilderSidePanel.tsx`) next to the
   existing "What we built" block -- shown once `project.performanceAudit`
   is present.
5. Tests: `tests/unit/agent/engine/performanceAudit.test.ts` (mocks
   `playwright` + `lighthouse` module boundaries; covers score/finding
   extraction from a realistic mocked LHR shape, timeout behavior via fake
   timers, and non-fatal failure), `tests/unit/web/components/
   PerformanceAuditPanel.test.tsx`.
6. README.md "What's implemented" update.

## Decisions

- No dedicated store/route work needed: `GET /projects/:id` already returns
  the full `Project` object, so adding `performanceAudit` to the shared type
  + normalizing it in `db/store.ts` (`p.performanceAudit ??= null`) is
  sufficient for the frontend to see it -- mirrors how visual-critic output
  already reaches the UI (no dedicated field/route for that either, it's
  log-line only; my audit result is a step further since it review requested
  "not just printed and discarded").
