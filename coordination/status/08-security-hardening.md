---
state: done
owner: 08-security-hardening
started: 2026-09-06T17:45:29Z
summary: CORS restricted to WEB_ORIGIN, X-Agent-Key auth on every non-/health route, apps/web now proxies through a same-origin Next.js route instead of calling apps/agent directly from the browser, rate limiting on project-create/chat routes, two P0 path-traversal fixes (export/screenshot download), task 04's dispatcher-bypass P0 fixed (delete_project/restore_checkpoint/restore_backup now gated+audited), npm audit run and documented. docs/SECURITY.md written.
---

## Ownership note

This task was originally started (2026-09-06T17:45:29Z) by a different live
session that pushed the initial status file + branch but crashed on a
session rate limit before writing any code (confirmed via that session
directly over SendMessage, and via `git log task/08-security-hardening`
showing only the coordination-scaffold commit). I took it over from scratch
per its own suggestion. No code from the original attempt existed to build
on or discard.

## SECURITY FIX (P0) -- two path-traversal bugs, fixed in this branch

`GET /projects/:id/export/:file` and `GET /projects/:id/screenshots/:file`
had **no project-existence check at all** and joined the attacker-controlled
`:file` route param directly onto a directory path with a bare `join()`.
Express decodes each route param independently, so
`GET /projects/x/export/..%2F..%2F..%2Fetc%2Fpasswd` arrived with
`req.params.file === "../../../etc/passwd"` -- `res.download()` /
`readFileSync()` then served whatever that resolved to. This was a live,
arbitrary-file-read vulnerability, and -- before this branch's auth fix
existed -- fully unauthenticated.

Fix: `apps/agent/src/middleware/safePath.ts`'s `resolveSafe(baseDir, seg)`
resolves the joined path and returns null if it escapes `baseDir`; both
routes now use it and also check the project exists first (matching every
other route in the file, which these two previously didn't).

Verified live against the exact payload above (project-id traversal,
export-file traversal, screenshot-file traversal) -- all three now 404
instead of leaking file contents. See Log for the full manual test session.

## SECURITY FIX (P0) -- folded in from task 04's dispatcher review

Task 04 found (`coordination/status/04-unit-dispatcher-security.md`) that
`DELETE /projects/:id`, checkpoint restore, and backup restore all bypassed
`tools/dispatcher.ts` entirely -- direct calls to `store.ts`/
`tools/checkpoint.ts`, no permission-tier gate, no audit-log entry, despite
being at least as destructive as `delete_page`/`run_wp_cli` (both already
gated + audited: `restoreCheckpoint`/`restoreBackup` run a real
`wp db import` against the live site; project delete is irreversible). Task
04 explicitly flagged this as needing 08 or 06 since the fix spans files
neither of us owned individually.

Fixed here, following task 04's suggested shape almost exactly:
- **`packages/shared/src/index.ts`**: added `delete_project`,
  `restore_checkpoint`, `restore_backup` as `destructive` `ToolName`s.
- **`apps/agent/src/tools/dispatcher.ts`**: added `execute()` cases for all
  three (the `delete_project` case does the real Docker teardown +
  `store.deleteProject` itself, moved from the route).
- **`apps/agent/src/routes/projects.ts`**: the three affected routes now
  call `callTool(project, <tool>, args, { confirm: true, source: "manual"
  })` -- the HTTP request itself is the explicit user action/confirmation
  UI, matching task 04's framing.

One subtlety task 04 didn't need to deal with (their scope was tests, not
this fix): `callTool`'s `finally` block unconditionally calls
`store.saveProject(project)` to persist the audit-log entry -- but a
successful `delete_project` has already removed that project's record from
the store inside `execute()`, so saving the in-memory `project` object
afterward would silently resurrect it. Added a narrow special case: skip
that save only when `tool === "delete_project" && ok === true` (a *failed*
delete still saves normally, since the project still exists and needs its
audit entry). Verified live: created a project, deleted it, confirmed
`GET /projects/:id` -> 404 and it does not reappear in `GET /projects`.

**Cross-file-ownership note for the Integrator:** this touches
`packages/shared/src/index.ts` and `apps/agent/src/routes/projects.ts`,
neither formally in task 08's "files you own" list -- flagging per protocol
step 5. Task 04's `tests/unit/agent/tools/dispatcher.test.ts` has two
`it.fails(...)` tests documenting this exact gap (search for "KNOWN GAP
(P0)"); whoever merges 04's branch should remove `.fails()` from both now
that the underlying behavior is fixed here. I did not touch that test file
myself (owned by task 04, and it doesn't exist on this branch since 04
hasn't merged yet).

## Decisions

- **CORS**: `WEB_ORIGIN` env var, defaults to `http://localhost:3000`.
  Static single-origin `cors({ origin: WEB_ORIGIN })`, not a
  function/allowlist -- one deployed web origin is the only case this repo
  actually has today; revisit if that ever needs to be a list.
- **Auth**: `AGENT_API_KEY` via `X-Agent-Key` header,
  `crypto.timingSafeEqual` compare, skipped entirely (with a loud startup
  warning) when unset -- matches this repo's existing "nothing required for
  local dev" convention rather than forcing a key even for `npm run dev`.
- **apps/web proxy, not a client-side header**: apps/web's client components
  called `apps/agent` directly (fetch + `EventSource` SSE) at
  `NEXT_PUBLIC_AGENT_URL`. Since `NEXT_PUBLIC_*` vars are bundled into
  client JS, the API key could never live there without handing it to every
  visitor. Added `apps/web/app/api/agent/[...path]/route.ts`, a same-origin
  Next.js route that proxies every method through to the real agent,
  attaching `X-Agent-Key` from a **server-only** `AGENT_API_KEY` (no
  `NEXT_PUBLIC_` prefix). Updated `apps/web/lib/api.ts` (base URL ->
  `/api/agent`, added `streamUrl()` replacing the old `agentUrl` export) and
  `components/ChatPanel.tsx` (EventSource now hits the proxy) accordingly.
  The proxy streams both directions (request body via `duplex: "half"`,
  response body pass-through) so SSE and binary export/screenshot downloads
  both work unbuffered -- verified live, not just typechecked (see Log).
- **Rate limiting placement**: applied at the specific routes
  (`POST /projects`, `POST /projects/:id/messages`,
  `GET /projects/:id/messages/stream`) rather than globally, since GET reads
  don't need it and the task brief specifically calls out
  project-creation/chat as the cost/abuse surface.
- **Validation scope**: read all four route files
  (`projects.ts`/`messages.ts`/`themes.ts`/`content.ts`) end to end looking
  for request input reaching a file path or shell command, not just adding
  generic checks. Found the two path-traversal bugs above; everything else
  already validates (theme/plugin slugs via allowlists, page IDs via
  `Number()`) or only builds filesystem/Docker paths from `project.id`
  *after* a `store.getProject()` lookup, not from the raw request param.
  Added a message-length cap (4000 chars) and project-name cap (200 chars)
  as cheap additional hardening, not because either was independently
  exploitable.
- **`npm audit`**: 3 moderate findings in `apps/agent`, all one
  `express -> body-parser -> qs` chain. Tried `npm audit fix`, `npm install
  --force`, and an `overrides` pin to `qs@6.16.0` in root `package.json` --
  none resolved it (body-parser's Express-4-line release doesn't yet
  resolve to the patched qs, and the override didn't take effect through
  the workspace lockfile; reverted the no-op override rather than leave
  dead config). Documented as an accepted, tracked risk in
  docs/SECURITY.md with reasoning (DoS-class, not RCE; this app doesn't
  parse complex bracketed query strings itself) rather than force-migrating
  to Express 5, which is a bigger change than a hardening pass should make
  as a side effect.
- **Test-instance isolation**: both apps/agent's real dev instance (port
  4001) and apps/web's (port 3000) were already running live under another
  session's QA testing when I went to smoke-test this. Ran all manual
  verification against isolated ports (agent :4099, web :3099) with a
  throwaway `.env`/`.env.local` and the agent's JSON-file store, all deleted
  afterward, specifically to avoid polluting or disrupting that session's
  data or environment.

## Verification

- `npm run typecheck` (root, fans out to all three packages) passes.
- `npm run build -w apps/web` (Next.js production build) succeeds; the new
  proxy route registers correctly as a dynamic route
  (`ƒ /api/agent/[...path]`).
- `npm audit` run across all three workspaces (`packages/shared`,
  `apps/agent`, `apps/web`) -- see finding + reasoning above.
- Manual live verification (isolated ports, cleaned up after, see Decisions):
  - Auth: no key -> 401, wrong key -> 401, correct key -> 200, `/health`
    open with no key.
  - CORS preflight: `Access-Control-Allow-Origin` reflects the configured
    `WEB_ORIGIN` regardless of the request's actual `Origin` header (correct
    -- the browser, not the server, enforces the match against its own
    origin).
  - Rate limiting: 32 rapid `POST /projects` -> first 30 succeed (201), then
    429.
  - Path traversal: crafted `%2F`-encoded `..` payloads against
    `:id`/`:file` on both export and screenshot routes -> 404, not a file
    leak.
  - Proxy: `apps/web`'s `/api/agent/*` correctly injects the server-side key
    (browser sends none) for a plain GET, a POST, and an SSE stream
    (`/messages/stream`, confirmed real streamed `user_message`/`done`
    events arrived through the proxy, not a single buffered blob).
  - `delete_project`/`restore_checkpoint` dispatcher fix: created a project,
    created a checkpoint, restored it (confirmed a `restore_checkpoint`
    audit-log entry with `"permission":"destructive"`), then deleted the
    project (confirmed 404 on re-fetch and absent from the project list --
    i.e. not silently resurrected by the dispatcher's own audit-save).
- No test files added on this branch -- 08's brief doesn't include a test
  deliverable (unlike 02-07), and 04/05/06 own the relevant test
  directories. The dispatcher fix above is covered by task 04's own
  `it.fails(...)` tests once `.fails()` is removed at merge time (see the
  SECURITY FIX section above).

## Log

- 2026-09-06T17:45:29Z: (prior session) Started, wrote initial status file,
  crashed on a session rate limit before any code.
- 2026-09-07: Took over (confirmed via SendMessage the prior session was
  stalled, not active). Read apps/agent/src/server.ts, all four route files,
  docker/compose.ts, tools/checkpoint.ts, tools/export.ts,
  tools/screenshot.ts, apps/web/lib/api.ts, apps/web/.env.example, and every
  client component calling the agent, to find real gaps rather than just
  bolt on generic middleware.
- Found both path-traversal bugs and the dispatcher-bypass gap (already
  flagged by task 04) during that read-through, before writing any fix.
- Implemented CORS/auth/rate-limit middleware, the two path-traversal fixes,
  the apps/web proxy route + lib/api.ts + ChatPanel.tsx updates, and the
  dispatcher fix (shared + dispatcher.ts + routes/projects.ts).
- Ran `npm audit` across all three workspaces; attempted three different
  fixes for the moderate qs finding, documented the outcome instead of
  forcing a breaking Express 5 upgrade.
- Full manual verification pass against isolated ports (agent :4099, web
  :3099), cleaned up all throwaway env files and JSON-store data afterward.
- Wrote docs/SECURITY.md and updated docs/DEPLOYMENT.md's CORS TODO.
- `npm run typecheck` and `npm run build -w apps/web` both green.
- state: done.
