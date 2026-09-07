---
state: in-progress
owner: 18-custom-domain-wizard
started: 2026-09-07T18:08:23Z
summary: Building a guided custom-domain connection wizard -- DNS record instructions + WP-CLI siteurl/home update, applied through the existing checkpoint + dispatcher/audit-log path, with a matching apps/web form near Export/Settings.
---

## Plan

- `apps/agent/src/tools/domain.ts` (new, owned): pure DNS-instructions
  generation (A/CNAME, markdown doc) + WP-CLI argv construction, plus the
  actual `execWpCli`-shelling function the dispatcher calls (same pattern as
  `tools/wordpress.ts`'s `updateOption`).
- `apps/agent/src/engine/domainWizard.ts` (new, owned): orchestration --
  `createCheckpoint` (manual) THEN `callTool(..., "update_domain", ...)`,
  same shape as `engine/incremental.ts`'s checkpoint-then-dispatch pattern.
- `packages/shared/src/index.ts`: additive -- new `update_domain` ToolName
  (permission tier: `destructive`, since it changes `siteurl`/`home` and a
  wrong domain/DNS combo can lock out `wp-admin`; the wizard's own route
  always passes `confirm: true`, same pattern as `restore_checkpoint`/
  `restore_backup`). Flagging this diff -- not in my owned-files list but
  required for the dispatcher chokepoint to know about the new tool.
- `apps/agent/src/tools/dispatcher.ts`: additive -- one new `case
  "update_domain"` in `execute()`. Flagging this diff too.
- `apps/agent/src/routes/projects.ts`: additive -- new
  `POST /:id/domain/preview` (pure, no mutation) and `POST /:id/domain/apply`
  endpoints appended at the end of the file. Flagging this diff (existing
  file, other tasks may also touch it).
- `apps/web`: new `DomainTab`-style panel wired into `BuilderSidePanel.tsx`'s
  Settings tab, additive only, `api.ts` gets two new client methods.
- Tests: `tests/unit/agent/tools/domain.test.ts` -- WP-CLI argv shape, DNS
  instruction text, checkpoint-before-dispatch ordering (mocking
  `tools/checkpoint.js`+`tools/dispatcher.js`, not `execa` -- this repo
  shells out via `node:child_process`'s `execFile` under
  `docker/compose.ts`, not `execa`; there is no `execa` dependency anywhere
  in the repo, so tests mock `@agent/docker/compose.js` exactly like
  `tests/unit/agent/tools/wordpress.test.ts` does).

## Decisions

- Permission tier `destructive` for `update_domain` (see above) rather than
  `write` -- more conservative given the "so it's undo-able" framing in the
  task brief, and it mirrors `restore_checkpoint`/`restore_backup`'s
  do-real-damage-if-wrong risk profile.
- Not touching `infrastructure/docker/templates/docker-compose.template.yml`
  or `docker/compose.ts` -- the template only exposes a local port bind
  (`127.0.0.1:__WP_PORT__:80`), there's no real reverse proxy / TLS
  termination to automate here, so the wizard documents (not automates) the
  docker-compose-side step, per the task's own "document rather than
  over-automate" instruction.

## Log

- 18:08 UTC -- worktree set up, `npm install` done, read
  docs/DEPLOYMENT.md, apps/agent/src/tools/export.ts,
  infrastructure/docker/, apps/agent/src/tools/{wordpress,checkpoint,
  dispatcher}.ts, apps/agent/src/routes/projects.ts, apps/web/lib/api.ts,
  apps/web/components/BuilderSidePanel.tsx, existing test patterns. Status
  file created, plan above. Starting implementation.
