---
state: done
owner: task-06-integration-routes
started: 2026-09-07
summary: Integration tests for apps/agent HTTP routes + orchestrator state machine (39 tests, 4 files), mocking Docker/WP-CLI/Playwright at their module boundaries. Fixed two real bugs found along the way (see Decisions).
---

# 06 - Integration tests for API routes & orchestrator

## What shipped

- `apps/agent/src/app.ts` (new): `createApp()` factory, split out of
  `server.ts` -- builds the real Express app with no side effects
  (no `listen()`, no `initStore()`), so tests can drive it via `supertest`.
  `server.ts` is now just this factory plus process-level wiring (env
  loading, `initStore`, `listen`, the unhandledRejection/uncaughtException
  backstops).
- `tests/integration/agent/helpers.ts` (new): shared test infra -- env setup
  forcing deterministic/offline mode, mocks for `@agent/db/store.js`,
  `@agent/docker/compose.js`, `@agent/tools/screenshot.js`,
  `@agent/engine/testRunner.js`, `@agent/middleware/rateLimit.js`, plus
  higher-level scenario helpers (`createProject`, `driveToThemeSelection`,
  `selectTheme`, `waitForStatus`, `buildProjectToReady`).
- `tests/integration/agent/projects.test.ts` (new, 12 tests): auth on every
  route but `/health`; full state machine CREATED -> ... -> READY through
  real HTTP calls, with the pipeline's dispatcher calls / checkpoint /
  audit-log all verified via the API; project listing; delete-through-the-
  dispatcher (SEC-03/05).
- `tests/integration/agent/messages.test.ts` (new, 10 tests): requirement-
  gathering chat; the edit-intent path proven to make exactly ONE dispatcher
  call for a single-tool edit (never a full rebuild); undo restoring the
  pre-edit checkpoint, read back through the API; SSE streaming proven to
  emit multiple discrete `delta` frames before the final `done` frame (both
  at the SSE-frame level and via real, separately-arriving raw HTTP data
  events), plus the no-AI-configured fallback path.
- `tests/integration/agent/themes.test.ts` (new, 8 tests): catalog listing,
  recommendations, slug allowlisting (SEC-06), the synchronous state
  transition on theme selection vs. the fire-and-forget build, and design
  variant merging.
- `tests/integration/agent/content.test.ts` (new, 9 tests): page listing/
  reading, the 409-when-not-running guard, manual save going through
  checkpoint-then-dispatcher (VER-02 + SEC-03/05) with an API read-back, and
  the AI-draft-then-save flow (including "the draft step alone touches
  nothing until the user saves").
- `apps/agent/package.json`: added `supertest`/`@types/supertest`
  (devDependencies) and a `test:integration` script (`vitest run
  integration`, filtering the shared config to just `tests/integration/`).
- Root `package.json`: added `test:integration` (delegates to the agent
  workspace -- `tests/integration/{shared,web}` don't exist yet).

Total: 4 new test files, 1 new helper file, 39 new tests, all passing.
`npm run test:unit` (which already picks up `tests/integration/agent/**`
per each workspace's `vitest.config.ts` `include`, per docs/TESTING.md)
shows 20 agent test files / 395 passed + 2 expected-fail (pre-existing,
untouched -- see Decisions) = 397, unchanged pass rate on everything that
existed before this task.

## Decisions

- **Mocking `@agent/db/store.js`.** docs/TESTING.md's "mock at this
  boundary" guidance is specifically about Docker/WP-CLI
  (`docker/compose.ts`); it doesn't mention `db/store.ts`. But the real
  store persists to `apps/agent/data/projects.json` on disk with no
  path-override hook, so using it unmocked would (a) write real files into
  the repo checkout on every test run and (b) make test isolation depend on
  Vitest's per-file module-registry reset rather than an explicit reset.
  Replaced it with an in-memory `Map`-backed fake exposing the exact same
  five-method surface (`listProjects/getProject/saveProject/deleteProject/
  listMessages/appendMessage`), reset in `beforeEach` via `resetWorld()`.
  Every route still calls the real store API; only the persistence backend
  changed. Precedent: `tests/unit/agent/tools/dispatcher.test.ts` and
  `checkpoint.test.ts` already mock this same module for the same "keep the
  test hermetic" reason.
- **Mocking `@agent/tools/screenshot.js` and `@agent/engine/testRunner.js`.**
  Both launch Playwright/Chromium directly against
  `project.docker.previewUrl` -- NOT through `docker/compose.js` -- so
  mocking the Docker/WP-CLI boundary alone still leaves a real headless
  browser launch against a URL nothing is serving. Without mocking these,
  the full-lifecycle test would need a real Playwright install and would be
  testing browser automation, not the HTTP + state-machine layer this task
  owns. Mocked to a fixed non-blank-screenshot result and a passing smoke
  suite, matching the "these are integration tests, not e2e tests"
  instruction directly.
- **Mocking `@agent/middleware/rateLimit.js` as pass-through.** The real
  limiters (20 chat messages/min, 30 project creates/15min, both per-IP,
  in-memory) are meant to bound abuse from an external caller. A single
  test file's full-lifecycle scenario (create -> ~4 requirement turns ->
  theme select -> several edits -> undo -> SSE test) legitimately exceeds
  20 requests from the same in-process loopback address well inside the
  same minute. Rate-limiting itself is not in this task's HTTP+state-
  machine scope, and no existing test file covers it either -- left as a
  gap for whoever owns that, rather than silently weakening it in
  `apps/agent/src` itself (only bypassed inside these tests' own mock).
- **Fake WP-CLI models real page CRUD, not everything.** `helpers.ts`'s
  `execWpCli` mock keeps a small in-memory per-project page store (mirroring
  `wp post create/update/delete/list/get`) because `content.test.ts` needs
  page reads/writes to actually round-trip for its assertions to mean
  anything. Menu/theme/plugin/option/eval/db-export-import calls are generic
  no-op successes -- nothing in this task's scope asserts on real menu
  structure or theme file contents (those are `tools/childtheme.test.ts`'s
  and `tools/wordpress.test.ts`'s job, at the unit level).
- **`llm/client.js` mocked only where a test needs it (`messages.test.ts`
  for SSE, `content.test.ts` for the AI-draft flow), not in `helpers.ts`.**
  Every other test relies on the *real* `aiAvailable()` returning `false`
  (no provider keys set -- see the env block in `helpers.ts`), exercising
  the real, deterministic heuristic code paths in `requirements.ts`,
  `editIntent.ts`, `designSystem.ts`, `critic.ts`. Where a test does mock
  the module, `completeText`/`completeVision` still resolve `null` by
  default so every code path that merely *checks* `aiAvailable()` elsewhere
  in the same request degrades to its real heuristic fallback instead of a
  fabricated AI answer -- only the one behavior under test (`streamAck`,
  `completeText`'s draft-JSON reply) is actually faked.
- **`SKILL_SOURCE=curated` / `THEME_SOURCE=catalog` forced in every test.**
  Without these, `engine/skills.ts`/`engine/themes.ts` make real outbound
  `fetch()` calls to `api.wordpress.org` (swallowed to "no result" on
  failure, so tests wouldn't hard-fail offline, but would be slow/flaky and
  is emphatically not what "integration test, not e2e" means here).

## Bugs found and fixed (flagged per the task's "if you find a real bug, fix
it and flag it loudly" instruction)

**1. `GET /projects/catalog` was completely unreachable -- route shadowing
in the router mount order.** `routes/projects.ts`'s `GET /:id` (a
single-path-segment catch-all: `store.getProject(req.params.id)`, 404 if not
found) was mounted (`app.use("/projects", projectsRouter)`) *before*
`routes/themes.ts`'s `GET /catalog` (also a single segment) -- this ordering
is verbatim what the original `server.ts` already did, so it's not something
the app.ts split introduced. Express tries routers/routes in registration
order and stops at the first one that sends a response -- so every request
for `GET /projects/catalog` was actually handled by `projectsRouter`'s
`/:id` as `store.getProject("catalog")` (always `undefined`), always
returning a 404 `{"error": "Project not found"}`, and `themesRouter`'s real
catalog handler was never reached. Confirmed via `themes.test.ts`'s catalog
test, which failed with exactly that 404 body before the fix. Grepped
`apps/web` for "catalog" -- zero hits, so nothing in the frontend currently
calls this route, which is presumably why it shipped silently broken.
**Fixed** in `apps/agent/src/app.ts` by mounting `themesRouter` before
`projectsRouter` (the only other router defining a single-segment route);
every other router here only defines multi-segment routes, so this is the
complete, minimal fix -- verified by `themes.test.ts`'s
`GET /projects/catalog returns the curated, offline theme catalog` test,
which now passes.

**2. Chat-typed "undo" bypassed `tools/dispatcher.ts` entirely -- no
permission-tier gate, no audit-log entry, for a real `wp db import` against
the live site.** `engine/incremental.ts`'s `applyEditIntent()`, in its
`"undo"` branch, called `tools/checkpoint.ts`'s `restoreCheckpoint()`
directly. This is the exact same class of P0 finding task 08 already fixed
for the *manual* restore route (`routes/projects.ts`'s `POST
/:id/checkpoints/:checkpointId/restore`, now routed through
`callTool(..., "restore_checkpoint", ..., { confirm: true, source:
"manual" })`) -- but the chat path (typing "undo" once a site is built) was
missed, and `restore_checkpoint` is marked `"destructive"` in
`TOOL_PERMISSIONS` precisely because it runs a real DB import. Every other
branch in `applyEditIntent` already goes through `callTool()`; this one
branch didn't. **Fixed** by routing it through
`callTool(project, "restore_checkpoint", { checkpointId: last.id }, {
confirm: true, source: "chat" })` instead, matching every other mutating
branch in the same function -- the user's own "undo" message is the
explicit confirmation, same reasoning task 08 used for the manual route.
Verified by `messages.test.ts`'s undo test, which asserts exactly one
`restore_checkpoint` audit-log entry (`ok: true, source: "chat", permission:
"destructive"`) shows up after a chat-driven undo.
`tests/unit/agent/tools/dispatcher.test.ts`'s two pre-existing `it.fails()`
tests (documenting that `tools/checkpoint.ts`'s `restoreCheckpoint`/
`restoreBackup` functions *themselves* still don't append audit entries when
called directly, independent of any particular call site) are untouched --
still correctly `.fails()`, since this fix changed a *call site*
(`incremental.ts`), not `checkpoint.ts` itself; not this task's file
ownership to reopen.

Both fixes are minimal, outside this task's stated file-ownership list
(`tests/integration/agent/**` + the `app.ts` split explicitly authorized in
the task instructions), and made only because they were real, verifiable
bugs surfaced directly by writing these tests -- not scope creep into
unrelated cleanup.

## Log

- 2026-09-07: Read docs/TESTING.md, docs/SECURITY.md, and the full route/
  engine/tool source tree. Confirmed server.ts does not yet export the app
  separately -- doing that refactor myself. Confirmed every Docker/WP-CLI
  call funnels through `docker/compose.ts`, except `tools/screenshot.ts` and
  `engine/testRunner.ts`, which launch Playwright directly against
  `project.docker.previewUrl` -- both need their own mock so the full build
  pipeline can run in-process without a real browser or WordPress site.
  Confirmed `engine/incremental.ts`'s "undo" branch calls
  `tools/checkpoint.ts` directly, bypassing the dispatcher -- flagged as a
  bug to fix once tests could prove it.
- 2026-09-08: Session resumed after a rate-limit interruption; picked up
  exactly where it left off (helpers.ts was already fully written). Built
  `app.ts`/`server.ts` split, the `incremental.ts` undo fix, `helpers.ts`,
  and all four test files. Hit and fixed one real Vitest gotcha: a
  `vi.mock()` factory referencing a plain top-level `const` directly (not
  wrapped in a nested closure) threw "Cannot access before initialization",
  because a later static `import` in the same file (of `./helpers.js`,
  which transitively imports the whole app) gets hoisted by the ES module
  loader ahead of that `const` -- fixed with `vi.hoisted()` in
  `messages.test.ts`. While writing `themes.test.ts`'s catalog test,
  discovered bug #1 above (route shadowing) the hard way -- the test failed
  against the real app before any fix. Fixed both bugs #1 and #2, listed
  above. Final verification: `npm run typecheck`, `npm run build`,
  `npm run lint`, and `npm run test:unit` all pass from the repo root of
  this worktree; `npm run test:integration` passes on its own too (39/39).
  Committing and pushing now.
