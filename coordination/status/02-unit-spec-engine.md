---
state: done
owner: 02-unit-spec-engine
started: 2026-09-06T00:00:00Z
summary: 103 passing unit tests for engine/{themes,designSystem,layout,requirements,editIntent}.ts, plus two small requirements.ts bug fixes found along the way.
---

## Notes

- `origin/integration` does not exist yet and `coordination/status/` had not
  been pushed by anyone as of this branch's creation. Per protocol step 1,
  branched `task/02-unit-spec-engine` directly from `origin/main` instead.
  Confirmed via cross-session messages with 03 (ai-wordpress-37) and 04
  (ai-wordpress-99), who hit the same situation and made the same call —
  Integrator (12) should create `integration` from `main`.
- Task 01 (test harness) has not landed yet either (no vitest anywhere in
  the repo as of branch creation). Writing tests now against plain Vitest
  syntax per the task instructions; will rebase onto 01's config once it
  lands. Verified my own tests run correctly in the meantime with a local,
  throwaway vitest invocation (not committed) — see Log.

## Decisions

- **SECURITY/CORRECTNESS-ADJACENT FIX** in `apps/agent/src/engine/requirements.ts`
  (`heuristicExtract`'s `pages` branch): the explicit "decline" phrase list for
  the extra-pages follow-up was `["looks good", "none", "no thanks", "no"]` --
  missing `"none of these"`, even though that's the *exact* wording of the
  immediately-preceding features question's own decline option, and the
  features branch two lines above it already handles `"none of these"`
  explicitly. Result: a user who (very plausibly) reuses that exact phrase to
  decline extra pages fell through to the generic direct-answer fuzzy
  choice-matcher, which partial-matched "none of these" against the "Looks
  good"/value:"none" choice and stored `pages: ["none"]` -- a literal page
  slug named "none" would have been created on the real site via
  `buildSiteSpecification`. Fixed by adding `"none of these"` to that list,
  matching the features branch. Regression test:
  `tests/unit/agent/engine/requirements.test.ts` > "restaurant site:
  extra-pages follow-up ... none of these ... clear pages to []".
- **BUG FIX** in `apps/agent/src/engine/requirements.ts`
  (`FEATURE_KEYWORDS.booking`): the keyword list only had singular
  `"reservation"`/`"appointment"`, and the word-boundary-matching in
  `detectFromKeywords` (a deliberate earlier fix for substring false
  positives) means the plural forms genuinely don't match the singular
  keyword. A very natural restaurant request -- "need a menu and online
  reservations" -- silently failed to detect the `booking` feature. Added
  `"reservations"`/`"appointments"`/`"bookings"` alongside the singular forms.
  Found via the realistic restaurant-site test case the task asked for.
- Both fixes are single-line-diff additions to existing arrays -- no
  behavior removed, no existing test weakened.
- `engine/themes.ts` has no AI-provider branch of its own (only
  catalog-vs-live-fetch modes); its "AI path" coverage is really
  `designSystem.ts`'s `buildDesignSystem`, which `themes.ts`'s
  `buildDesignVariants` calls into deterministically (no LLM call there
  either). Noted in themes.test.ts's top comment so this isn't mistaken for
  missing coverage.
- `deriveSecondaryColor`'s exact-value assertions use an independent
  hex->HSL decoder written fresh in designSystem.test.ts (not copied from
  src) plus tolerance-based invariant checks (hue rotation ~150°, saturation
  clamped 45-85%, lightness rule per mode), rather than hand-computed golden
  hex strings -- avoids baking in a manual-arithmetic mistake while still
  substantively verifying the real color math, per the task's "assert real
  color values" ask.
- requirements.test.ts and editIntent.test.ts both mock
  `engine/skills.js` wholesale (not just env vars) so no test ever makes a
  real network call to wordpress.org; skill-discovery *behavior itself* is
  task 03's file to test in depth. THEME_SOURCE-gated live search IS tested
  directly in themes.test.ts (mocked global fetch, both success/failure).
- Verified 103/103 tests pass, `npm run typecheck` (root, all 3 workspaces)
  and `npm run build` (root, all 3 workspaces) all green, via a local
  `npm install -D vitest --no-save` in this worktree only (not committed --
  no vitest.config.ts or package.json changes made; task 01 owns those).

## Log

- Branch created from origin/main (ea4eba1, "theme expansion"). Read
  engine/{themes,designSystem,layout,requirements,editIntent}.ts and
  llm/client.ts and skills.ts to plan coverage.
- Wrote and green-lit themes.test.ts (13 tests), designSystem.test.ts (23),
  layout.test.ts (17), requirements.test.ts (25, after fixing 2 real bugs
  surfaced by the realistic-input test cases + a few of my own wrong test
  assumptions), editIntent.test.ts (25). 103 total.
- Confirmed via cross-session messages: 03 (content/copy engine) and 04
  (dispatcher/security) hit the same "no integration branch yet" situation
  and made the same branch-from-main call; 03 finished and pushed
  (state: done) while I was writing these. 01 (test harness) is in progress
  in its own worktree but hit a push-permission block on its own session for
  the integration branch -- flagging this to the human directly since it's
  not mine to route around.
- state: done. Committing and pushing task/02-unit-spec-engine now.
