---
state: in-progress
owner: 17-scheduled-backups
started: 2026-09-07T00:00:00Z
summary: Adding a periodic backup scheduler + retention/pruning policy on top of the existing manual VER-04 backup mechanism, routed through the dispatcher/audit log.
---

## Plan

- `packages/shared/src/index.ts`: add `create_backup` / `delete_backup` to
  `TOOL_NAMES`/`TOOL_PERMISSIONS`, add `"scheduled"` to `AuditLogEntry.source`,
  add optional `ProjectBackup.source` (`"manual" | "scheduled"`).
- `apps/agent/src/tools/checkpoint.ts`: `createBackup` takes an optional
  `source` param (defaults `"manual"`), stamps it on the `ProjectBackup`; new
  `deleteBackup(project, backupId)` removes the backup's files + record.
- `apps/agent/src/tools/dispatcher.ts`: new `create_backup` / `delete_backup`
  cases calling into checkpoint.ts -- this is now the *only* path that
  creates or deletes a backup, manual or scheduled.
- `apps/agent/src/scheduler.ts` (new): `computeBackupsToPrune()` (pure,
  count + optional max-age retention) and `runScheduledBackup()` /
  `startBackupScheduler()` (interval timer over `store.listProjects()`,
  gated on `AUTO_BACKUP_INTERVAL_MINUTES`), both driving backup creation
  and pruning exclusively through `callTool`.
- `apps/agent/src/routes/projects.ts`: `POST /:id/backups` now goes through
  `callTool("create_backup", ..., source: "manual")` + the same retention
  helper, instead of calling `createBackup` directly (this closes a
  pre-existing dispatcher bypass for manual backups too).
- `apps/agent/src/server.ts`: minimal wiring to start the scheduler at boot.
- `apps/web`: `HistoryTab` in `BuilderSidePanel.tsx` shows a
  scheduled/manual badge per backup (additive).
- `.env.example` + `README.md`: new vars, "What's implemented" blurb.

## Status

Implementation in progress.
