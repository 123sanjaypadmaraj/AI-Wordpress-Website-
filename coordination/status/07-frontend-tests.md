---
state: done
owner: 07-frontend-tests
started: 2026-09-06T23:15:00Z
summary: 46 passing component/a11y tests for apps/web (dashboard, chat, requirements, themes, content, build progress), several real a11y/bug fixes applied, manual live sanity-check pass done.
---

## Decisions

- **01-test-harness hadn't pushed anything to origin when I started** (its
  worktree at `../aiwp-task-01` has real, working Vitest config for
  apps/web, but it was all uncommitted, and still is as of this writing).
  Per the protocol I didn't block -- I read its uncommitted
  `apps/web/vitest.config.mts`, `tests/unit/web/setup.ts`, `tests/tsconfig.json`,
  and `docs/TESTING.md` from its worktree (read only, never wrote there) and
  mirrored them into my own worktree byte-for-byte (setup.ts) or near-exactly
  (vitest config, tests/tsconfig.json), so this merges cleanly whenever 01
  lands. **Shared-file flag**: I created `apps/web/vitest.config.mts`,
  `tests/tsconfig.json`, and `tests/unit/web/setup.ts` myself -- none are in
  my "files you own" list, but 01's own harness wires them in as
  `setupFiles`/project config and none of it existed committed anywhere. If
  01 pushes first, the diff against mine should be tiny (I added a
  `jest-axe` matcher registration to setup.ts, plus a `scrollIntoView`
  polyfill jsdom needs for ChatPanel's auto-scroll effect -- both are
  additive, nothing removed).
- Added `jest-axe` + `@types/jest-axe` (not `@axe-core/react`) for the
  accessibility pass -- runs directly against Testing Library's rendered
  container in Vitest/jsdom with no React-specific wrapper needed. Added a
  small `vitest`-`Assertion` type augmentation (`tests/unit/web/jest-axe.d.ts`)
  since jest-axe only ships Jest-namespace types. `color-contrast` stays
  disabled (jest-axe's own default, since jsdom does no real layout/paint) --
  contrast was checked manually against `apps/web/tailwind.config.ts`'s fixed
  palette instead (ink-muted #8B8FA8 on canvas #0F1117 computes to ~5.9:1,
  comfortably above the 4.5:1 AA text threshold).
- Also added `@testing-library/user-event` (not in 01's uncommitted
  devDependency list as of when I checked) for realistic typing/click
  interactions in the chat and form tests.

## What I found and fixed (apps/web/components only, no redesigns)

1. **ChatPanel: silent dead-end on any failed send.** Both the non-SSE
   fallback (`api.sendMessage` rejecting) and a mid-stream SSE disconnect
   (`EventSource.onerror` before a `"done"` event) previously just reset the
   composer with zero indication anything went wrong, discarding the typed
   message. Now surfaces a `role="alert"` banner and restores the input
   text so the user can retry without retyping. Covered by
   `tests/unit/web/components/ChatPanel.test.tsx`.
2. **ChatPanel: message input had no accessible name** (placeholder only) --
   added `aria-label="Message"`.
3. **BuilderSidePanel: form fields used a plain `<div>` as a visual label
   with zero programmatic association** to their input/select/textarea --
   real axe "label" violations on the Requirements and Content tabs. Fixed
   with real `<label for=...>` for single-control fields, and
   `role="group"`/`aria-label` for the Pages/Features chip groups (a
   `<label>` can't wrap several buttons without misdirecting a click on the
   label text to just the first one).
4. **BuilderSidePanel: Pages/Features/theme-variant chip buttons didn't
   expose toggled state to assistive tech** -- added `aria-pressed`.
5. **BuilderSidePanel: the tab strip was plain buttons with no indication
   they were tabs or which was selected** -- added
   `role="tablist"`/`role="tab"` + `aria-selected`.
6. **BuilderSidePanel: a failed build (status `ERROR`) rendered the exact
   same pipeline checklist as a brand-new project**, with the only signal
   being the small status pill -- added a `role="alert"` banner on the
   Progress tab pointing at the log.
7. **BuilderSidePanel: stopping a fully-built site's environment (status
   `STOPPED`) made the build-progress checklist regress to "nothing done
   yet"**, even though `apps/agent/src/routes/projects.ts`'s
   `environment/stop` route only ever reaches `STOPPED` from a completed
   build (and `environment/start` puts it straight back to `READY`). Fixed
   by having every pipeline step's `states` list include `STOPPED` alongside
   `READY`, with a code comment flagging the backend assumption this relies
   on for whoever touches that route next. **Verified live** (see below),
   not just in the test.

All of the above are covered by tests in `tests/unit/web/components/
{ChatPanel,BuilderSidePanel}.test.tsx` and `tests/unit/web/app/page.test.tsx`
(46 tests total, 3 files), including a dedicated `checkA11y()` pass (via
`tests/unit/web/a11y.ts`) on every major screen/state: dashboard
loading/empty/error/mixed-status, chat with messages/choices/error banner,
Requirements tab, Themes tab (with THM-05 variants), Progress tab on a
failed build, and the Content tab mid-edit. No violations remain after the
fixes above.

## Found but NOT fixed (outside apps/web, flagging for whoever owns it)

- **Backend: AI-provider chat replies can come back truncated mid-sentence.**
  During the live manual pass (see below) I hit a live agent instance (not
  mine -- see next section) that had a real AI provider configured, and its
  assistant reply to the very first message in a fresh project was stored
  (and rendered, correctly, by ChatPanel -- this is a backend content bug,
  not a rendering bug) as `"Got it, a website for your local bakery with a
  menu and online ordering sounds delicious! Are"` -- cut off mid-word, no
  continuation. This is `apps/agent/src/engine/requirements.ts`'s
  `aiExtract()` -> `completeText()` (`apps/agent/src/llm/client.ts`) path;
  `maxTokens` there is already a generous 512, so the truncation isn't an
  obvious off-by-one -- worth a closer look at whatever provider/model was
  actually configured on that instance. I could not reproduce this against
  my own agent instance in heuristic mode (no API key), where the same
  heuristic reply path always returns a complete sentence. Not something I
  can fix (apps/agent/src/engine and llm/client.ts are outside my file
  ownership for this task) -- flagging here since it directly affects chat
  quality and isn't caught by any existing test I could find.

## Manual sanity-check pass (deliverable 3)

Ran `npm run dev:agent`/`npm run dev:web` equivalents myself. **Important
environment note for whoever reads this next**: this machine runs many
parallel Claude sessions against the same physical repo location, and
`apps/agent`'s default port 4001 and `apps/web`'s default port 3000 were
*already bound by another session's dev servers* when I started mine (their
`npm run dev:agent`/`dev:web` silently `EADDRINUSE`'d and I initially didn't
notice -- my first browser pass was actually exercising a **different
session's** running agent + its real Docker projects and a real configured
AI provider, which is how I found the truncation bug above). I deleted the
one throwaway project I'd created there and moved my own testing to
dedicated ports (agent on 4011, web on 3011) pointed at each other via
`NEXT_PUBLIC_AGENT_URL`, so the rest of this pass is against my own
worktree's code with a clean, empty project store. Tore both down and
confirmed the shared 3000/3010/4001 instances were untouched when done.

Verified live in a real browser against my own build:
- **No projects yet**: clean empty state, no blank screen.
- **Full create -> requirements chat (heuristic mode, no API key) ->
  theme selection (real wordpress.org-backed recommendations + THM-05
  variants) -> real Docker build -> READY**: every intermediate status
  (Installing / Generating / Configuring / Ready) rendered a sensible,
  non-blank Progress tab with a live-updating log; Preview tab auto-showed
  the real built site; Content tab loaded and displayed real WP pages with
  working label associations.
- **Stopped environment on a finished build**: confirmed via a direct API
  call (avoided clicking the button myself since it's gated behind a native
  `confirm()`, which the browser-automation safety guidance says not to
  trigger) that the Progress tab now correctly shows every step complete
  instead of regressing (fix #7 above), then restarted the environment and
  deleted the test project.
- **SSE disconnect**: attempted a live repro by killing my own agent process
  mid-send, but my browser actions raced the page's post-navigation JS and
  never actually landed a message before the kill -- didn't force a second
  attempt given time budget, since the fix (#1 above) is already covered by
  a deterministic, passing unit test that exercises exactly this path
  (`ChatPanel.test.tsx` > "shows an error and restores the input on a
  mid-stream disconnect").
- Did not attempt a live **failed build**: forcing a real Docker/WP-CLI
  failure on shared infrastructure felt like more risk than value given
  fix #6 is already covered by a passing unit test asserting the alert
  banner renders on `status: "ERROR"`.

## Verification

- `npm run typecheck -w apps/web` -- clean.
- `npx tsc -p tests/tsconfig.json` -- clean (all new test files + fixtures
  type-check).
- `npx vitest run` in `apps/web` -- 46/46 passing, 3 files.
- `npm run build -w apps/web` -- clean production build.
- Root `npm run typecheck`/`npm run build` were not re-run at the very end
  of this session since apps/agent/packages/shared are untouched by this
  task and were already green earlier in the session; the apps/web-scoped
  commands above cover everything this task actually changed.

Pushed to `task/07-frontend-tests`. Ready to merge whenever the Integrator
gets to it -- rebase onto 01-test-harness's actual (still-unpushed as of
this writing) harness commit will likely be a no-op or near-no-op given how
closely this mirrors it, but flagging that as the one thing to double-check
at merge time.
