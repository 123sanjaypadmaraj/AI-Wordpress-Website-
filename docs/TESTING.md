# Testing

This repo has three test tiers. All three are wired up and passing as of
this writing; sessions 02-07 (see `docs/PARALLEL_EXECUTION_PLAN.md`) are
expected to fill in real coverage against the conventions below.

| Tier | Runner | Lives under | Needs Docker/live WP? |
| --- | --- | --- | --- |
| Unit | Vitest | `tests/unit/<package>/` | No |
| Integration | Vitest | `tests/integration/<package>/` | No (mocked) |
| End-to-end | Playwright | `tests/e2e/` | Yes |

## Running tests locally

```bash
npm install                 # once, from repo root

npm run test:unit           # unit + integration tests, all 3 workspaces
npm run test:unit -w apps/agent   # ...just one workspace

npm run test                # same suite as test:unit today (see below)
npm run test:watch          # all 3 workspaces in watch mode, side by side
npm run test:watch -w apps/web    # ...just one workspace, interactive

npm run lint                # eslint, all 3 workspaces
npm run typecheck           # tsc --noEmit, all 3 workspaces + tests/

npm run test:e2e:install    # once, installs the Playwright browser
npm run test:e2e            # tests/e2e/ against a running site (see below)
```

`test` and `test:unit` run the exact same thing right now. They're kept as
separate scripts on purpose: every test in this repo today (unit *and*
integration) mocks its own I/O and runs in milliseconds, so there's no slow
tier to split out yet. If a genuinely slow/flaky integration tier shows up
later (e.g. something that really does need a live service), give it its
own Vitest `--project` or config and point `test` (but not `test:unit`) at
it — don't repurpose these two scripts to mean something else.

## Directory convention

**Test files live in the mirrored tree under `tests/unit/<package>/` and
`tests/integration/<package>/`, not colocated next to source.** `<package>`
is `shared`, `agent`, or `web`, matching `packages/shared`, `apps/agent`,
`apps/web`. Mirror the source path under that:

```
packages/shared/src/index.ts            -> tests/unit/shared/index.test.ts
apps/agent/src/engine/layout.ts         -> tests/unit/agent/engine/layout.test.ts
apps/agent/src/tools/dispatcher.ts      -> tests/unit/agent/tools/dispatcher.test.ts
apps/web/components/StatusBadge.tsx     -> tests/unit/web/components/StatusBadge.test.tsx
apps/agent/src/routes/messages.ts       -> tests/integration/agent/messages.test.ts
```

One convention, one place to look -- this is deliberate given how many
sessions are writing tests in parallel against this repo. Each workspace's
`vitest.config.ts` (`packages/shared/vitest.config.mts`,
`apps/agent/vitest.config.ts`, `apps/web/vitest.config.mts`) only picks up
tests from these two trees (via its own `test.include`, resolved relative
to that config file), not from `src/`.

Each workspace's Vitest config sets `test.root` to that workspace's own
directory. Practically, that means:

- Run a workspace's tests via `npm run test:unit -w <workspace>` (or `cd`
  into it and run `vitest`/`npx vitest`) -- running bare `vitest` from repo
  root has no config of its own and won't find anything.
- Each config's `include` glob reaches *up* out of its own directory
  (`../../tests/unit/<package>/**`) to find its test files. This is a
  normal, supported glob pattern for Vite/Vitest -- nothing repo-root-only
  about it.

### Importing source from a mirrored test file

- **`tests/unit/shared/**`**: import the real package name, e.g.
  `import { emptySiteSpecification } from "@ai-wp/shared";`. It's an npm
  workspace, so this resolves via the `node_modules/@ai-wp/shared` symlink
  -- the same way `apps/agent` and `apps/web` consume it for real.
- **`tests/unit/agent/**`**: import via the `@agent/*` alias, e.g.
  `import { classifyError } from "@agent/engine/errors.js";` (configured in
  `apps/agent/vitest.config.ts`, mapped to `apps/agent/src/*`). Keep the
  `.js` extension on relative-style specifiers -- same convention the app's
  own source uses (it's an ESM package; the extension is resolved to the
  `.ts` file by Vite/Vitest, same as it is by `tsx` at runtime).
- **`tests/unit/web/**`**: import via the existing `@/*` alias, e.g.
  `import { StatusBadge } from "@/components/StatusBadge";` -- this is the
  *same* alias `apps/web`'s own source already uses (see
  `apps/web/tsconfig.json`), now also wired into `apps/web/vitest.config.mts`
  so tests can use it too.

Both aliases are scoped to their own workspace's Vitest config, so they
don't leak into other workspaces or collide with scoped npm package names
(`@ai-wp/*`, `@testing-library/*`, etc. still resolve normally).

### Type-checking test files

`tests/tsconfig.json` type-checks everything under `tests/unit/` and
`tests/integration/` (with the same three aliases above configured as TS
`paths`, for IDE support and `tsc`), and `npm run typecheck` runs it as an
extra step after the three workspaces. This is separate from each
workspace's own `tsconfig.json` deliberately: those are also used for
`build` (`apps/agent`'s emits real `.js` to `dist/`), and pulling
repo-root test files into that `include` would make `tsc --noEmit false`
try to emit build output for test files too. `tests/tsconfig.json` is
`noEmit`-only and never touches `build`.

### apps/web component tests

`apps/web/vitest.config.mts` uses `environment: "jsdom"` and
`@vitejs/plugin-react`, plus a shared setup file
(`tests/unit/web/setup.ts`) that adds `@testing-library/jest-dom`'s
matchers (`toBeInTheDocument()`, etc.) and calls Testing Library's
`cleanup()` after every test so rendered DOM doesn't leak between test
files. You don't need to import either of those yourself -- just:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/StatusBadge";

it("renders a label", () => {
  render(<StatusBadge status="READY" />);
  expect(screen.getByText("Ready")).toBeInTheDocument();
});
```

## Mocking WP-CLI / Docker calls

Nothing in `tests/unit/` or `tests/integration/` should require Docker or a
real WordPress instance to be running -- that's what `tests/e2e/` is for.
Every real Docker/WP-CLI call in this codebase funnels through
`apps/agent/src/docker/compose.ts`, which wraps `node:child_process`'s
`execFile` (via `promisify`). **Mock at that module boundary**, not
`node:child_process` directly, in every file except `compose.ts`'s own
test:

- **Testing `apps/agent/src/docker/compose.ts` itself** (if/when a session
  adds that test): mock `node:child_process`'s `execFile` directly with
  `vi.mock("node:child_process", ...)`. This is the one file that's
  actually allowed to know `execFile` exists.
- **Testing anything in `apps/agent/src/tools/*.ts`** (`wordpress.ts`,
  `plugins.ts`, `childtheme.ts`, `checkpoint.ts`, `export.ts`) or
  `apps/agent/src/tools/dispatcher.ts`: mock `../docker/compose.js`'s
  exports (`execWpCli`, `compose`, `composeCp`, `readProjectSecret`, etc.),
  **not** `node:child_process`. These modules never call `execFile`
  directly -- they call `execWpCli()`/`compose()` -- so mocking one level
  up is both simpler and keeps the test from caring about the exact
  `docker compose exec ...` argv shape unless that's specifically what's
  under test (e.g. `tools/wordpress.ts`'s test, per the plan, *should*
  assert exact WP-CLI argv -- mock `execWpCli` and assert on the args it
  was called with).

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent/docker/compose.js", () => ({
  execWpCli: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  readProjectSecret: vi.fn().mockReturnValue("fake-secret"),
}));

// import the module under test AFTER the mock -- vi.mock is hoisted above
// imports by Vitest, so this ordering in the source is fine either way,
// but keep it top-of-file for readability.
import { execWpCli } from "@agent/docker/compose.js";
import { installWordPressCore } from "@agent/tools/wordpress.js";

it("passes the generated admin credentials to `wp core install`", async () => {
  // ...arrange a fake Project, call installWordPressCore(project)...
  expect(execWpCli).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining(["core", "install", expect.stringContaining("--admin_user=")]),
  );
});
```

For retry-logic tests (dispatcher, WP-CLI tool calls under transient
failure), pair this with `vi.useFakeTimers()` +
`await vi.runAllTimersAsync()` so a bounded retry with backoff doesn't
actually sleep in the test run -- see
`tests/unit/agent/engine/errors.test.ts` (this session's example) for the
exact pattern against `engine/errors.ts`'s `withRetry()`, which
`dispatcher.ts` and the tools layer build their own retry behavior on top
of.

For `apps/agent/src/tools/export.ts` specifically (per task 05's plan): the
export bundle is real file content assembled from several sources, not
just an exec call -- mock the compose/exec layer the same way, then assert
on the *actual generated file contents/paths*, including the "no secret
ends up in the export" grep-style check the plan calls for.

## Example tests (this session's proof-of-life)

One real test per workspace, proving the harness works end to end without
overlapping any file sessions 02-07 own:

- `tests/unit/shared/index.test.ts` -- `emptySiteSpecification()` and the
  `TOOL_PERMISSIONS`/`EMPTY_SLOTS` shapes.
- `tests/unit/agent/engine/errors.test.ts` -- `classifyError()` and
  `withRetry()` from `engine/errors.ts` (deliberately *not* `layout.ts`,
  `themes.ts`, `dispatcher.ts`, or anything else already claimed by
  sessions 02-06's file lists).
- `tests/unit/web/components/StatusBadge.test.tsx` -- a real Testing
  Library render of `StatusBadge`.

These are meant to be small and self-contained, not a down payment on real
coverage -- don't extend them; add your own files alongside per the
convention above.

## CI

`.github/workflows/ci.yml` runs four jobs on every push/PR:

- `typecheck-build` -- `npm run typecheck && npm run build` (existing).
- `lint` -- `npm run lint` (new).
- `unit-tests` -- `npm run test:unit` (new).
- `e2e-smoke` -- `playwright test --list` only (existing; see below).

All four jobs pin Node 22 (`actions/setup-node@v4`, `node-version: "22"`),
bumped up from 20 -- see "Why Node 22, not 20" below.

### Why Node 22, not 20

Vitest 5 requires Node `^22.12 || ^24 || >=26` and doesn't run on Node 20 at
all; `jsdom` 29 (used for `apps/web`'s component tests) requires `^20.19 ||
^22.13 || >=24`. Root `package.json`'s `engines.node` and CI's
`setup-node` version were both bumped from `>=20`/`"20"` to `>=22.12`/`"22"`
to match. If anything downstream (deployment, a Dockerfile) still assumes
Node 20, it needs to move to 22+ too -- flagged loudly in this session's
`coordination/status/01-test-harness.md` for task 10's Dockerfile.

### Why `eslint` is pinned to 9.x, not 10.x

`eslint` 10 is very new. `eslint-config-next@16.3.4`'s own transitive
dependencies (`eslint-plugin-react@7.37.5`, `eslint-plugin-import@2.32.0`,
`eslint-plugin-jsx-a11y@6.10.2`) declare `peerDependencies` capped at
`eslint@^9.x` -- installing `eslint@^10` alongside `eslint-config-next`
produces an unresolvable peer conflict (`npm install` reports an invalid,
deduped `eslint@9.x` under `@eslint/js@10.x`'s hard requirement of
`^10.0.0`). `eslint-config-next`'s own peer range (`>=9.0.0`) is happy with
9.x, and `typescript-eslint@8.69` supports both -- so every workspace pins
`eslint`/`@eslint/js` to `^9.39.5` for a clean, single resolved version
across the monorepo. Revisit this once `eslint-config-next` ships a release
whose own plugin deps support `eslint@10`.

### `next lint` is gone

Next.js 16 removed the `next lint` command entirely in favor of running
ESLint directly (see `node_modules/next/dist/docs/.../config/eslint.md`
once installed, or the Next.js docs). `apps/web/eslint.config.mjs` is a
flat config built from `eslint-config-next/core-web-vitals` +
`eslint-config-next/typescript`; `apps/web`'s `lint` script is a plain
`eslint .`.

One rule is intentionally downgraded from error to warn in that config
(`react-hooks/set-state-in-effect`) because it currently flags a real,
pre-existing pattern in `apps/web/app/page.tsx` (an unconditional refresh
call in a mount-only `useEffect`) that's application behavior, not test
harness or lint config -- fixing it belongs to session 07's app/component
bug-fix pass, per `docs/PARALLEL_EXECUTION_PLAN.md`. It's tracked as a
warning rather than silenced so it doesn't get lost, and doesn't fail CI on
day one for something this task doesn't own. Same reasoning applies to a
`@next/next/no-img-element` warning in `BuilderSidePanel.tsx` (already a
warning, not an error, so it needed no config change).

### Why e2e isn't a real CI run yet

`tests/e2e/site.spec.ts` needs a real, already-built WordPress site to
point `PREVIEW_URL` at (see `tests/e2e/playwright.config.ts`). Standing
that up in CI means, at minimum: a Docker-capable runner (GitHub's
`ubuntu-latest` does have Docker available), the `apps/agent` server
actually running, a full project pushed through its state machine
(`CREATED` → ... → `READY`) via real API calls or a seed script, and then
pointing Playwright at whatever port got allocated. That's the same
infrastructure task 11's `npm run demo` / `demo-seed.ts` is being built to
provide (and task 08's `AGENT_API_KEY`/`WEB_ORIGIN` work affects how the
agent server needs to be invoked headlessly). Building a second, parallel
version of that orchestration here -- ahead of and independent from task
11 -- would be duplicated, throwaway work, not a shortcut. So `e2e-smoke`
stays a `--list`-only sanity check (a broken spec file still fails CI) for
now. Once task 11's demo-seed path lands, the natural follow-up is a CI job
that runs `npm run demo` (or a slimmer non-interactive variant of it)
against a heuristic-only project (no API key required) and then points
`test:e2e` at the resulting `PREVIEW_URL`.
