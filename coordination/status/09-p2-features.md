---
state: in-progress
owner: 09-p2-features
started: 2026-09-07T00:00:00Z
summary: Implementing the four remaining P2 backlog items (live container stats, side-by-side theme comparison, deployment-instructions generator, post-generation theme switching) end to end -- agent route + UI -- each in its own clearly-named file(s) per the task brief.
---

## Scope

Per README.md's "Remaining backlog" line:

1. Live container stats -- per-project `docker stats` polled from the agent, small UI panel.
2. Side-by-side theme comparison -- extend the theme picker to compare 2-3 candidates' swatches before choosing.
3. Deployment-instructions generator -- per-project markdown doc with concrete steps to move the built site to real hosting.
4. Post-generation theme switching -- change a built site's theme after the fact via the dispatcher, re-applying the generated child theme's design system, with a checkpoint first.

## Plan (see Log for what actually shipped)

- **Stats**: new `apps/agent/src/docker/stats.ts` (docker stats query, read-only,
  not dispatcher-gated -- same convention as `docker/compose.ts`'s own
  start/stop/restart, which also aren't dispatcher calls), new
  `apps/agent/src/routes/stats.ts` (`GET /projects/:id/stats`), new
  `apps/web/components/ContainerStatsPanel.tsx` polling every ~3s, wired into
  a new "Stats" tab in `BuilderSidePanel.tsx`.
- **Theme comparison**: UI-only. New `apps/web/components/ThemeComparison.tsx`
  consuming the existing `project.themeRecommendations` (catalog + variants
  already computed server-side); `BuilderSidePanel.tsx`'s Themes tab gets a
  "Compare" checkbox per theme (max 3) that renders it.
- **Deployment instructions**: new `apps/agent/src/tools/deploymentInstructions.ts`
  (sibling to `tools/export.ts`, pure function of `project.spec` -- no Docker
  dependency), a route in `routes/projects.ts` near the export routes, new
  `apps/web/components/DeploymentInstructionsPanel.tsx` in the Settings tab.
- **Post-generation theme switching**: new `packages/shared`'s `switch_theme`
  ToolName (tier `write`), a dispatcher case wiring `install_theme` +
  `generateAndActivateChildTheme` together as one audited call, new
  `apps/agent/src/engine/themeSwitch.ts` (checkpoint-first orchestration,
  mirroring `engine/incremental.ts`'s shape), a route on `routes/themes.ts`,
  new `apps/web/components/ThemeSwitchPanel.tsx` in the Settings tab.

## Decisions

(filled in as work proceeds)

## Verification

(filled in at the end)

## Log

- 2026-09-07: Read docs/ARCHITECTURE.md, docs/TESTING.md, docs/SECURITY.md,
  README.md, and the dispatcher/themes/designSystem/childtheme/checkpoint/
  export/wordpress/compose/server/routes/BuilderSidePanel/api.ts source.
  Wrote this status file and the plan above. Starting implementation.
