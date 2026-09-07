---
state: in-progress
owner: 14-distributed-rate-limit
started: 2026-09-07T18:08:06Z
summary: Adding an optional Redis-backed rate-limit store (RATE_LIMIT_STORE=memory|redis) to apps/agent/src/middleware/rateLimit.ts, keeping the existing in-memory default unchanged. In progress.
---

## Plan

- `apps/agent/src/middleware/rateLimit.ts`: extend (not rewrite) to read
  `RATE_LIMIT_STORE` (default `memory`) and, when `redis`, build a shared
  `rate-limit-redis` store backed by `ioredis`, reading `REDIS_URL`. Fail
  loudly (throw, crashing startup) if Redis is unreachable rather than
  silently falling back to per-process memory -- a rate limiter that
  silently no-ops under load is worse than a startup crash that gets
  noticed immediately.
- New deps: `ioredis` (chosen over `redis`/node-redis for API-shape
  consistency reasons -- logged at startup which backend is active) +
  `rate-limit-redis`. Pinned `rate-limit-redis@^4.3.1` specifically because
  `rate-limit-redis@^5`/`^6` require `express-rate-limit >= 8.5`, and this
  repo is on `express-rate-limit@^7.5.1` (not in this task's scope to bump).
- Startup-time Redis connectivity check implemented via top-level `await`
  in `rateLimit.ts` itself (module evaluation throws if Redis is
  unreachable) rather than adding a new call in `server.ts` -- keeps this
  task's diff inside its owned files and still crashes startup before
  `app.listen` (routes/*, which import this module, are themselves
  imported before `initStore()`/`listen()` run).
- Tests: `tests/unit/agent/middleware/rateLimit.test.ts`, mocking `ioredis`
  + `rate-limit-redis` (per docs/TESTING.md's "mock at the module
  boundary" convention) -- no real Redis instance required.
- Docs: `apps/agent/.env.example` (additive-only: `RATE_LIMIT_STORE`,
  `REDIS_URL`) and `docs/SECURITY.md`'s rate-limiting paragraph.

## Log

- 2026-09-07T18:08Z -- status file created, `npm install` running in the
  worktree.
