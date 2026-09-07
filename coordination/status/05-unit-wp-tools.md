---
state: done
owner: 05-unit-wp-tools
started: 2026-09-07T13:16:38Z
summary: 103 unit tests across tests/unit/agent/tools/{wordpress,plugins,childtheme,checkpoint,export}.test.ts (exact WP-CLI argv assertions, plugin-allowlist enforcement, real generated-CSS assertions, checkpoint/backup round-trips, export bundle contents). One real P0 fix in export.ts -- the "credential-free" export was leaking the live DB password -- with a regression test. All pass typecheck + lint + vitest against 01's harness.
---

## Decisions

- **Branched from `origin/integration`** (it existed by the time I started;
  no base-mismatch note needed).
- **01-test-harness's `docs/TESTING.md`/`vitest.config.ts`/`tests/tsconfig.json`
  are not yet committed on `origin/integration`** (still uncommitted in
  the `aiwp-task-01` worktree as of this writing). Building against that
  interface anyway per the shared protocol -- it's detailed and stable
  enough to write against directly (module alias `@agent/*`, mock
  `@agent/docker/compose.js`'s exports rather than `node:child_process`,
  mirror-tree test paths). Will rebase/verify once 01 pushes.
- To actually run these tests locally before 01's harness lands on
  `integration`, I copied my test files into the `aiwp-task-01` worktree
  (which already has vitest installed) as a scratch execution environment
  only -- nothing was committed there, and that worktree's git state is
  untouched by me.
- **SECURITY FIX (small, flagged per protocol item 5) in
  `apps/agent/src/tools/export.ts`** -- not a file I own, but directly
  contradicts the "credential-free export" claim my own test file
  (`export.test.ts`) is supposed to verify, so I fixed it rather than just
  documenting a known-failing assertion. See "SECURITY FIX" section below
  for detail. This is a `tools/` file inside apps/agent/src -- no other
  task's file-ownership list claims it (checked all worktrees for
  in-progress conflicting edits to `export.ts` or the docker-compose
  template before making this change; none found). I explicitly avoided
  editing `infrastructure/docker/templates/docker-compose.template.yml` /
  `apps/agent/src/docker/compose.ts` (the deeper root cause) after that
  edit was blocked by this session's permission classifier (edits touching
  `*_PASSWORD` template lines) -- the export.ts-level redaction fixes the
  actual leak (nothing a viewer of the exported zip can read) without
  needing that edit.

## SECURITY FIX (real finding, fixed in this branch)

**`apps/agent/src/tools/export.ts`: the exported "credential-free" project
bundle shipped a live DB password.** `renderCompose()` in
`apps/agent/src/docker/compose.ts` bakes the project's real, randomly
generated `DB_PASSWORD`/`DB_ROOT_PASSWORD` directly into the per-project
`docker-compose.yml` on disk (its `environment:` blocks), not just into the
sibling `.env` file. `exportProject()` copied that `docker-compose.yml`
into the export bundle byte-for-byte -- so every exported zip's
`deploy/docker-compose.yml` contained the live site's actual DB and DB-root
passwords, directly contradicting this module's own doc comment
("Deliberately leaves generated DB secrets out of the export ... rather
than shipping live credentials in a downloadable file") and the README's
"credential-free" claim.

Fix: added `redactSecrets()` in `export.ts`, which reads this project's
actual `DB_PASSWORD` / `DB_ROOT_PASSWORD` / `WP_ADMIN_PASSWORD` via the
existing `readProjectSecret()` and strips every literal occurrence from the
copied compose YAML before it's written into the export bundle, replacing
each with a `${VAR}` placeholder. Scoped to the export boundary (the one
place secrets must never leave) rather than the live per-project compose
file (which legitimately needs the real values for `docker compose up` to
work today).

Regression test: `tests/unit/agent/tools/export.test.ts` -- builds a
fixture project with a real (fake) secret value baked into a fixture
`docker-compose.yml` the same way the real renderer does, mocks the
WP-CLI/compose-cp calls, runs `exportProject`, then greps every file
written into the export staging dir for the literal secret value and for
generic secret-shaped substrings. Verified this test fails against the
pre-fix code (temporarily reverted the `redactSecrets` call, confirmed the
grep check catches the leaked password; re-applied the fix).

## Verification

01-test-harness pushed real (committed) work to `task/01-test-harness`
partway through this session (`f0f81ce`), still not merged into
`integration` as of this writing. Verified against that real, committed
harness (not just the earlier uncommitted WIP): copied this branch's 5 test
files + the fixed `export.ts` into the `aiwp-task-01` worktree as a
scratch execution environment only (nothing committed there, its own git
state fully restored/untouched afterward -- confirmed clean with `git
status` before finishing), and ran:

- `npx vitest run` (apps/agent workspace) -- **103/103 passed**, all 5
  files.
- `npx tsc -p tests/tsconfig.json --noEmit` -- clean (had to cast 4
  `execWpCliMock.mockImplementation(...)` callbacks `as typeof
  execWpCli`, since `execWpCli`'s real return type is `PromiseWithChild`
  from `promisify(execFile)`, not a plain `Promise` -- fixed in this
  branch's test files).
- `npx tsc --noEmit` (apps/agent workspace, i.e. `export.ts` itself) --
  clean.
- `npx eslint src/tools/export.ts` -- clean.
- Confirmed the SECURITY FIX regression test actually catches the bug:
  temporarily reverted `redactSecrets()`'s use in the scratch copy,
  reran `export.test.ts` -- 3 tests failed including "never lets the real
  DB password ... reach any file in the bundle", confirming it's a real
  regression test and not a tautology. Re-applied the fix, reran -- green.

This branch itself doesn't carry 01's harness files (vitest.config.ts,
docs/TESTING.md, tests/tsconfig.json, root/agent package.json changes) --
those are 01's to add at merge time, same pattern task 04 used (confirmed
by checking their worktree). `npm run typecheck`/`npm run build` from repo
root aren't runnable on this branch alone until 01 is merged in; the
verification above is the equivalent check done against 01's real branch
directly.

## Log

- 13:16 UTC -- worktree set up, read docs/TESTING.md (from aiwp-task-01,
  then-uncommitted) and all 5 source files under test. Found and fixed the
  export.ts secret-leak above.
- wordpress.test.ts and plugins.test.ts written, committed, pushed (WIP).
- childtheme.test.ts, checkpoint.test.ts, export.test.ts written.
- Received and answered a cross-session ownership check (another session
  confirming task 05 wasn't stalled before it considered picking it up) --
  confirmed active, no handoff needed.
- Ran full verification (see above); fixed 3 test-file bugs found along
  the way (a wrong expected db_id in a removeMenuItemForPage test, an
  exportsListDir()-has-a-mkdir-side-effect false assumption, and a
  Node-version-fragile recursive-readdir helper) plus the 4 TS typing
  casts. All green. Status set to done.
