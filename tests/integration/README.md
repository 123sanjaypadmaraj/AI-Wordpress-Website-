# tests/integration

Same convention as `tests/unit/` (see `docs/TESTING.md`): one directory per
package (`shared`, `agent`, `web`), mirroring the `src/` path of what's
under test, run by that package's own `vitest.config.ts` via
`npm run test:unit -w <workspace>` (or root `npm run test:unit`).

The difference from `tests/unit/` is scope, not tooling: integration tests
here exercise multiple modules together through a real boundary -- e.g.
`apps/agent`'s HTTP routes end to end via `supertest` against the exported
Express app (see `docs/PARALLEL_EXECUTION_PLAN.md`'s task 06), rather than
one function in isolation. They still mock Docker/WP-CLI (see
`docs/TESTING.md`'s "Mocking WP-CLI / Docker calls" section) -- nothing
under `tests/unit/` or `tests/integration/` should need a live Docker
daemon or WordPress instance. That's what `tests/e2e/` is for.

This directory is currently a placeholder (no content yet owned by this
session) -- see `docs/PARALLEL_EXECUTION_PLAN.md` task 06 for
`tests/integration/agent/{projects,messages,themes,content}.test.ts`.
