---
state: in-progress
owner: 13-multi-tenant-auth
started: 2026-09-07T00:00:00Z
summary: Adding real per-user auth (username/password + JWT session tokens) and per-project ownership authorization, closing the gap docs/SECURITY.md flags under "No per-user auth or multi-tenancy." Sits alongside the existing AGENT_API_KEY deployment secret, does not replace it.
---

## Scope

New work item (not part of the original 12-task plan) closing the
multi-tenancy gap `docs/SECURITY.md` documents under "What this does NOT
protect against." Scoped for this codebase's reality: a local-first,
single-deployment Docker tool used by a handful of trusted people behind
one shared `AGENT_API_KEY`, not a public SaaS. So: username/password with
bcrypt, stateless signed JWT sessions, per-project `ownerId` + an
authorization middleware -- no OAuth, no email verification, no
password-reset flow (see docs/SECURITY.md's updated gap list for the full
honest accounting).

## Plan (see "## Decisions" below for the reasoning behind each choice)

1. `apps/agent/src/db/users.ts` -- new, self-contained user store (JSON
   file by default, optional Postgres, mirroring `db/store.ts`'s own
   pattern but decoupled from it to avoid touching a file other tasks may
   also touch).
2. `apps/agent/src/middleware/sessionAuth.ts` -- JWT issue/verify +
   `requireSession` middleware, mounted globally alongside (not instead of)
   `requireApiKey`.
3. `apps/agent/src/routes/auth.ts` -- `POST /auth/register`, `POST
   /auth/login`, `POST /auth/logout`, `GET /auth/me`.
4. `apps/agent/src/middleware/ownership.ts` -- `requireProjectOwnership`,
   applied per-route (not as a blanket `/projects/:id` path-prefix -- see
   Decisions) across `routes/projects.ts`, `routes/messages.ts`,
   `routes/themes.ts`, `routes/content.ts`.
5. `packages/shared/src/index.ts` -- `Project.ownerId: string | null`.
6. `apps/web`: login/register page, `lib/session.ts` token storage,
   `lib/api.ts` forwards `Authorization: Bearer <token>`, an `AuthGuard`
   wrapping the app shell.
7. Tests under `tests/unit/agent/{db,middleware,routes}/` +
   `tests/integration/agent/auth.test.ts`.
8. `apps/agent/.env.example`, `docs/SECURITY.md` updated.

## Decisions

(filled in as work proceeds)

## Files touched outside my own new files

- `apps/agent/src/server.ts` -- wiring `initUsersStore()`, mounting
  `authRouter`, mounting `requireSession` globally after `/auth`.
- `apps/agent/.env.example` -- new `SESSION_SECRET`/`SESSION_TTL` vars.
- `docs/SECURITY.md` -- "What this does NOT protect against" rewritten.
- `apps/agent/src/middleware/rateLimit.ts` -- added `authLimiter` (existing
  file, additive only).
- `apps/agent/src/routes/{projects,messages,themes,content}.ts` --
  `requireProjectOwnership` inserted per-route; `projects.ts` also sets
  `ownerId` on create/duplicate and filters `GET /projects` to the caller's
  own projects.
- Test fixtures with a full `Project` literal (7 files under
  `tests/unit/agent/tools/*.test.ts` + `tests/unit/web/fixtures.ts`) each
  get one added `ownerId: null,` line for the new required field.

## Log

- 2026-09-07: read docs/SECURITY.md, docs/ARCHITECTURE.md, auth.ts,
  store.ts, server.ts, routes/*, apps/web/lib/api.ts, the proxy route,
  docs/TESTING.md. Ran `npm install` from repo root (succeeded, 3 moderate
  pre-existing audit findings, unrelated to this task -- see
  docs/SECURITY.md's existing npm-audit section). Wrote this status file.
  Starting implementation.
