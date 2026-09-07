---
state: done
owner: 04-unit-dispatcher-security
started: 2026-09-06T00:00:00Z
summary: 25 security-focused unit tests for apps/agent/src/tools/dispatcher.ts, plus one real P0 fix in dispatcher.ts (audit log was silently skipped for permission-tier rejections) and one hardening change (strict confirm check). One P0 gap found but NOT fixed here (out of file-ownership scope) -- see below.
---

## SECURITY FIX (P0) -- fixed in this branch

**apps/agent/src/tools/dispatcher.ts: destructive-call rejections were never
audited.** `callTool`'s permission-tier check
(`if (permission === "destructive" && !opts.confirm) throw ...`) ran
*before* the function's try/finally block. Since the audit-log write lives
in that `finally`, any destructive tool call rejected for missing
confirmation threw straight out of `callTool` and left **zero trace** in
`project.auditLog` -- directly contradicting this module's own header
comment ("Records a redacted, structured entry in project.auditLog (SEC-05)
for every attempt, success or failure"). An attacker (or a buggy caller)
probing destructive tools without confirmation would leave no audit trail
at all, which is exactly the case an audit trail most needs to catch.

Fix: moved the confirmation check inside the try block so it's covered by
the same finally-block audit write as every other rejection (allowlist,
execution failure, etc.). Also hardened the check from `!opts.confirm` to
`opts.confirm !== true`, since `DispatchOptions.confirm` is typed
`boolean` but any caller building `opts` from untyped/JSON input (a route
body, a deserialized tool call) could otherwise pass a truthy non-boolean
(e.g. the string `"false"`) and have it treated as confirmed.

Regression test: `tests/unit/agent/tools/dispatcher.test.ts` ->
"SECURITY FIX regression: a rejected destructive call is still audited
(was previously silently dropped)", plus a dedicated adversarial-payload
test for the truthy-string-confirm case. Verified both fail against the
pre-fix code (reverted the fix locally, confirmed the regression test
fails; re-applied).

## P0 FINDING -- NOT fixed in this branch, needs a cross-file change

**Project delete and DB restore/undo bypass the dispatcher entirely --
no confirmation gate, no audit-log entry, at all.**

- `apps/agent/src/routes/projects.ts` `DELETE /:id` calls
  `store.deleteProject(id)` directly.
- Its checkpoint/backup restore routes call
  `tools/checkpoint.ts`'s `restoreCheckpoint`/`restoreBackup` directly.

None of these three ever go through `dispatcher.callTool` -- there isn't
even a `ToolName` entry for them in `packages/shared/src/index.ts`. Given
the module's own doc comment calls it "intentionally the *only* place"
WordPress-affecting operations should flow through, and `restoreCheckpoint`
overwrites `project.spec` (undo) and can run a real `wp db import` against
the live site, this is at least as destructive as `delete_page`/
`run_wp_cli` (both gated + audited) yet has neither protection.

I did not fix this myself: a real fix means adding `ToolName` entries +
`execute()` cases in dispatcher.ts (fine, in my scope) **and** rewiring
`routes/projects.ts` to call `callTool(..., { confirm: true, source:
"manual" })` instead of calling `checkpoint.ts`/`store.ts` directly, which
touches `packages/shared/src/index.ts` and `routes/projects.ts` -- neither
owned by this task, and both plausibly live wires for 06
(integration-routes) and 08 (security-hardening) right now.

Proof, not just a claim: `tests/unit/agent/tools/dispatcher.test.ts` has
two tests marked `it.fails(...)` -- "KNOWN GAP (P0): restoreCheckpoint
should append an audit-log entry but currently doesn't" and the same for
restoreBackup. Each asserts the *desired* audited behavior; `.fails()`
means they show green now (documenting the gap) and will start failing
the suite -- forcing a decision -- the moment someone's change makes the
underlying assertion true. Whoever picks this up should remove `.fails()`
at that point.

**Action needed:** 08-security-hardening and/or 06-integration-routes,
please pick this up (I could not identify which live session owns 08 via
ListAgents -- sessions aren't named by task number -- so relying on this
status file + a courtesy ping to any reachable ai-wordpress-* session).
Suggested shape: add `restore_checkpoint`, `restore_backup`,
`delete_project` as destructive `ToolName`s, add `execute()` cases calling
the existing checkpoint.ts/store.ts functions, update the three routes in
projects.ts to call `callTool` with `confirm: true` (the route itself is
the explicit user action / confirmation UI).

## Other Decisions

- **origin/integration did not exist when I started** (verified via
  `git ls-remote --heads origin` -- only `main`). Branched
  `task/04-unit-dispatcher-security` from `origin/main` per protocol.
  Integrator: create `integration` from `main` if still missing.
- `coordination/status/` didn't exist on any branch -- created as part of
  this branch's first commit.
- **01-test-harness had not landed** (its branch was identical to `main`).
  Added a minimal, self-contained Vitest setup scoped to `apps/agent` only:
  `apps/agent/vitest.config.ts` (new, root: repo root, include:
  `tests/unit/agent/**/*.test.ts`) and `test`/`test:watch` scripts +
  `vitest` devDependency in `apps/agent/package.json`. **Touches
  package-lock.json** (adds vitest + its transitive deps) -- shared file,
  flagged here; should merge mechanically (npm resolves it on next
  install) but note it in case 01/05/06/07 add vitest too and the
  Integrator needs to reconcile lockfile entries.
- Deliberately did NOT mock `tools/plugins.ts` or `engine/themes.ts` in the
  test file -- the allowlist tests exercise the real `isAllowedTheme`/
  `isAllowedPlugin` logic against adversarial slugs, only mocking the
  underlying `tools/wordpress.ts` WP-CLI calls. Mirrors docs/TESTING.md's
  eventual "mock at the module boundary" convention (not yet written by
  01, but this is the obvious boundary here).
- Minor (not fixed, out of scope): `engine/errors.ts`'s `classifyError`
  defaults unrecognized errors to `"transient"`. That means dispatcher's
  own validation-style errors that don't match a FATAL_PATTERN -- e.g.
  `update_page`/`delete_page`'s "No existing page with slug X" and
  `run_wp_cli`'s "restricted to: ..." -- get one wasted retry + ~1.5s delay
  before the real (permanent, not transient) error surfaces. Not a
  security issue, just latency/noise. Whoever owns engine/errors.ts next
  (no task currently lists it) could either classify these as fatal at the
  throw site or pull dispatcher-level validation out of the retried
  callback, same pattern as this branch's confirm-check fix.
- Also noted, not touched: the pre-existing `FATAL_PATTERNS` entry
  `/requires confirmation/i` in engine/errors.ts never actually matched
  dispatcher's real message ("...requires *explicit* confirmation") --
  harmless after this fix (the confirm-check throw no longer goes through
  withRetry at all), but looks like a stale/dead pattern for whoever
  touches that file next.

## Verification

- `npm run typecheck` and `npm run build` both pass from repo root.
- `npm run test -w apps/agent` -- 25/25 passing (tests/unit/agent/tools/dispatcher.test.ts).
- Confirmed the fix actually matters: reverted it locally, watched the
  "SECURITY FIX regression" test fail, re-applied, watched it pass.
- Confirmed the two known-gap tests are real (not vacuous): temporarily
  stripped `.fails()`, watched both fail with the exact "expected 1, got 0"
  audit-log-not-written signature, restored `.fails()`.

## Log

- Created worktree + branch, wrote status file (in-progress).
- Read dispatcher.ts + every module it touches (themes.ts, plugins.ts,
  errors.ts, store.ts, wordpress.ts, compose.ts, checkpoint.ts,
  routes/projects.ts) to find real gaps, not just write coverage.
- Found and fixed the audit-log-bypass-on-rejection P0; found and
  documented (via `.fails()` tests) the routes-bypass-dispatcher-entirely
  P0.
- Set up minimal Vitest for apps/agent (01 hadn't landed).
- Wrote tests/unit/agent/tools/dispatcher.test.ts (25 tests).
- Verified typecheck/build/tests all green; committing + pushing now.
- state: done.
