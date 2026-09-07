# Security

This document is the honest version: what this app protects against today,
what it does not, and what a real production deployment (beyond a live demo
for people you trust) still needs. It was written as part of a hardening
pass -- see `coordination/status/08-security-hardening.md` for the full
change log and the P0 findings below.

## Threat model

`apps/agent` is, by design, extremely powerful: every route eventually has
**Docker-socket-level power** -- spinning up/tearing down a real WordPress
container per project, running arbitrary WP-CLI against a real database, and
reading/writing files under `infrastructure/docker/projects/<id>/`. There is
no per-user sandboxing *inside* that -- the isolation boundary is **one
Docker Compose stack per project** (see `infrastructure/docker/`), not one
per human user. Anyone who can authenticate to this API can do anything to
any project it manages.

That means the security model here has exactly one job: **control who can
reach the API at all**, and bound what a single caller can do once they're
in. It is deliberately not a multi-tenant, per-user-permission system --
see "What this does NOT protect against" below.

## What changed in this pass

Before this pass, `apps/agent/src/server.ts` had `app.use(cors())` with no
origin restriction and **no authentication on any route** -- anyone who
could reach the port (default 4001) had unrestricted Docker/WP-CLI access to
every project. That's fixed:

### 1. CORS (`WEB_ORIGIN`)

`app.use(cors())` -> `app.use(cors({ origin: WEB_ORIGIN }))`. Defaults to
`http://localhost:3000` for local dev; set it to your deployed `apps/web`
origin in production. See `apps/agent/.env.example`.

### 2. API-key auth (`AGENT_API_KEY`)

Every route except `GET /health` now requires an `X-Agent-Key` header
matching `AGENT_API_KEY` (`apps/agent/src/middleware/auth.ts`), compared
with `crypto.timingSafeEqual` rather than `===` (a naive string compare
leaks how many leading bytes matched via response timing). If
`AGENT_API_KEY` is unset, auth is skipped -- matching this repo's existing
"nothing is required to run the agent" local-dev convention -- but the
server logs a loud warning on startup so this can't silently ship
unauthenticated.

**This is a shared secret, not a user-auth system.** One key, one trust
level: anyone with the key can do anything to any project. See "What this
does NOT protect against."

Since a browser talking directly to `apps/agent` would need to know this
key (handing it to every visitor if it were bundled client-side), the
browser no longer talks to `apps/agent` directly at all:

### 3. The `apps/web` proxy (`app/api/agent/[...path]/route.ts`)

`apps/web`'s client components used to call `apps/agent` directly (both
plain `fetch` and the chat panel's `EventSource` SSE stream) at
`NEXT_PUBLIC_AGENT_URL` -- a `NEXT_PUBLIC_*` variable is bundled into
client-side JS, so anything sensitive can never live in one. A new Next.js
route handler at `apps/web/app/api/agent/[...path]/route.ts` proxies every
method (GET/POST/PUT/PATCH/DELETE) through to the real agent, attaching
`X-Agent-Key` from a **server-only** `AGENT_API_KEY` env var (no
`NEXT_PUBLIC_` prefix -- see `apps/web/.env.example`). `apps/web/lib/api.ts`
and the chat panel's `EventSource` now both point at this same-origin
proxy path instead of the agent's real URL. Streaming (the SSE chat
endpoint) and binary downloads (export zips, screenshots) are passed
through as a raw body stream, not buffered.

Net effect: the browser only ever talks to its own origin. The real agent
URL and its API key live only in `apps/web`'s server environment.

### 4. Rate limiting

`apps/agent/src/middleware/rateLimit.ts`, applied at the two routes that
trigger real spend/work per request rather than globally:

- `POST /projects` (project creation -- each one eventually spins up a
  Docker/WordPress environment): 30 requests / 15 min / IP.
- `POST /projects/:id/messages` and `GET /projects/:id/messages/stream`
  (chat -- each turn can reach an AI provider): 20 requests / min / IP.

### 5. Input validation -- two P0 path-traversal fixes

Auditing `routes/projects.ts`, `routes/messages.ts`, `routes/themes.ts`,
and `routes/content.ts` for request input reaching a file path or shell
command found two real, exploitable bugs (not just missing coverage):

**`GET /projects/:id/export/:file` and `GET /projects/:id/screenshots/:file`
had no project-existence check at all, and joined the attacker-controlled
`:file` param directly onto a directory path.** Express decodes each route
param independently, so a request like
`GET /projects/x/export/..%2F..%2F..%2Fetc%2Fpasswd` arrived with
`req.params.file === "../../../etc/passwd"`, and the resulting
`join(exportsListDir(...), file)` / `join(screenshotDir(...), file)` walked
straight out of the intended directory -- `res.download()` /
`readFileSync()` then happily served whatever was there. This was a live,
unauthenticated (pre-#2 above) arbitrary-file-read on the host. Fixed with
a new `resolveSafe()` helper (`apps/agent/src/middleware/safePath.ts`) that
resolves the joined path and rejects anything that escapes the base
directory, used at both routes (which now also check the project exists
first, matching every other route in the file). Verified against the exact
payload above -- see `coordination/status/08-security-hardening.md`'s Log.

Everything else in these four route files either already validates its
input (theme/plugin slugs go through allowlists in `engine/themes.ts` /
`tools/plugins.ts`; numeric IDs go through `Number()`) or only ever
constructs filesystem/Docker paths from `project.id` *after* a
`store.getProject()` lookup has already proven that ID is a real,
store-issued project -- not from the raw request param. Also added: a
length cap on chat message text (`MAX_MESSAGE_LENGTH`, 4000 chars) and on
project names (200 chars), since both can reach an AI provider or get
stored/displayed indefinitely otherwise.

`docker/compose.ts`'s `execWpCli`/`compose()` already used `execFile` with
an argument array (never a shell string), so there was no shell-injection
vector to fix there -- just the path-traversal one above.

### 6. P0 fix folded in from task 04's dispatcher review

Task 04 (`coordination/status/04-unit-dispatcher-security.md`) found, but
was out of file-ownership scope to fix, that **project delete and
checkpoint/backup restore bypassed `tools/dispatcher.ts` entirely**: no
permission-tier gate, no audit-log entry, for operations at least as
destructive as `delete_page`/`run_wp_cli` (both already gated + audited) --
`restoreCheckpoint`/`restoreBackup` run a real `wp db import` against the
live site, and project delete is irreversible. Fixed here: added
`delete_project`, `restore_checkpoint`, `restore_backup` as `destructive`
`ToolName`s (`packages/shared/src/index.ts`), added `execute()` cases for
them in `tools/dispatcher.ts`, and rewired the three routes in
`routes/projects.ts` to call `callTool(..., { confirm: true, source:
"manual" })` -- the HTTP request itself is the explicit user
action/confirmation UI mentioned in task 04's suggested fix.

One wrinkle specific to delete: `callTool`'s `finally` block always calls
`store.saveProject(project)` to persist the audit-log entry it just
appended -- but `delete_project`'s `execute()` case removes the project
from the store entirely, and saving the in-memory `project` object
afterward would silently resurrect it. `callTool` now skips that save
specifically when `tool === "delete_project" && ok === true` (a failed
delete still saves normally, since the project still exists). Verified by
creating a project, deleting it, and confirming it does not reappear in
`GET /projects`. A side effect worth knowing: once a project is deleted,
its own audit log goes with it -- there's no separate global audit trail in
this codebase's data model, so "an audited deletion" here means the
deletion goes through the same permission-tier gate as everything else, not
that a record of it survives the deletion. A real multi-tenant deployment
that needs post-deletion audit retention would need a separate,
project-independent audit store.

Task 04 also left two `it.fails(...)` tests in
`tests/unit/agent/tools/dispatcher.test.ts` documenting this exact gap;
whoever merges that branch should remove `.fails()` now that the underlying
behavior is fixed.

### 7. `npm audit`

`packages/shared` and `apps/web`: 0 vulnerabilities.

`apps/agent`: 3 moderate-severity findings, all one transitive chain:
`express` -> `body-parser` -> `qs` (`GHSA-x5fp-wj9c-mxmx`,
`GHSA-4mjr-xmp4-gh2g` -- an array-limit bypass and a DoS via attacker-
controlled `isBuffer` in `qs`'s bracket/array query-string parsing).
`npm audit fix` (and `npm install --force`) could not resolve this: the
patched `qs` (6.16.0) isn't yet what `body-parser`'s published Express-4
line resolves to, and the only route `npm audit fix --force` offers is a
major-version jump to Express 5, which is out of scope for a hardening
pass (a framework migration deserves its own review, not a drive-by
version bump here). Accepted as a known, tracked risk rather than silently
ignored:

- This is a **DoS/parsing-edge-case** class of issue, not RCE or an auth
  bypass.
- None of this app's own routes parse complex bracketed/array query strings
  (`?a[b][c]=x`) -- the only query param in active use is `?text=` on the
  SSE endpoint, a plain string. The vulnerable code path in `qs` is
  exercised by Express's own body/query parsing internals regardless, so
  the risk isn't zero, but it's not amplified by anything this app does.
- Revisit when `body-parser` ships a release pinning a patched `qs`, or
  when an Express 5 migration is separately planned.

## What this DOES protect against

- Any website's browser JS calling this API cross-origin (CORS).
- Anyone without the shared secret reaching any route with Docker/WP-CLI
  power (API-key auth).
- The API key itself ever reaching a browser (server-only proxy).
- Arbitrary file reads via crafted export/screenshot download requests
  (path-traversal fix).
- A single caller (or a runaway script) generating unbounded Docker
  environments or AI-provider spend (rate limiting).
- Destructive project operations (delete, checkpoint/backup restore)
  happening without going through the same permission-tier + audit-log path
  as every other mutation.

## What this does NOT protect against

Being honest about the gaps matters more than looking finished:

- **No per-user auth or multi-tenancy.** `AGENT_API_KEY` is one shared
  secret for the whole deployment. Anyone holding it can read, edit, or
  delete *any* project, not just their own. If this app ever serves
  multiple independent customers, it needs a real user-auth system
  (sessions or per-user API keys) plus per-project authorization checks
  layered on top of everything in this document -- none of which exists
  today.
- **No TLS termination here.** `AGENT_API_KEY` travels as a plain header;
  without TLS in front of `apps/agent` (a reverse proxy, a platform's
  built-in TLS, etc.) it's sent in the clear, same as any other credential
  over plain HTTP. Terminate TLS in front of this service in any real
  deployment.
- **Secrets live in `.env` files**, per this repo's existing convention
  (`ANTHROPIC_API_KEY`, `AGENT_API_KEY`, DB credentials in each project's
  generated `.env` -- see `docker/compose.ts`). Fine for a demo; a real
  production deployment should use a real secrets manager (its platform's
  built-in one, Vault, etc.) instead of `.env` files on disk.
- **Rate limiting is per-IP and in-memory** (`express-rate-limit`'s default
  store). It resets on restart and doesn't share state across multiple
  agent instances -- fine for the single-process deployment this repo
  targets today (see `docs/DEPLOYMENT.md`), not sufficient if this is ever
  horizontally scaled without a shared store (Redis, etc.).
- **The Docker-socket boundary is the isolation, and it's coarse.** Every
  project's WP-CLI/Docker calls run with whatever privileges the agent
  process's Docker socket access grants -- there's no per-project user
  namespacing beyond what Docker Compose gives you by default. A
  compromised or malicious WordPress plugin inside one project's container
  is not assumed to be contained beyond normal Docker container boundaries.
- **No CSRF protection** -- not needed today (auth is a header, not a
  cookie, so a third-party page can't ride a browser's ambient session into
  a request the way it could with cookie auth), but worth re-checking if
  auth ever moves to cookies/sessions.
