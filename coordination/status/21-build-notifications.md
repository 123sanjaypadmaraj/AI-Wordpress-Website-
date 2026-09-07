---
state: in-progress
owner: 21-build-notifications
started: 2026-09-07T00:00:00Z
summary: Adding pluggable build-complete/failed webhook notifications (agent-side notifier module + orchestrator wiring + per-project settings field in the web UI).
---

## Plan

1. `apps/agent/src/notifications/notifier.ts` -- channel-agnostic
   `BuildNotificationEvent` type, `NotificationChannel` interface, and
   `sendNotification()`/`notifyBuildTerminal()` entry points. Never throws;
   retries each channel up to twice with backoff (reusing
   `engine/errors.ts`'s `withRetry`), then gives up silently (console log
   only).
2. `apps/agent/src/notifications/webhook.ts` -- the one implemented channel:
   POSTs a JSON payload to a configured URL. No-ops (does not even attempt
   a request) when no URL is resolved for the event.
3. `apps/agent/src/engine/orchestrator.ts` -- minimal wiring: fire-and-forget
   call to `notifyBuildTerminal()` at the two terminal-state transitions
   (`READY` success path, `ERROR` catch path). Flagging this file touch per
   protocol -- other tasks may also touch the state machine.
4. `packages/shared/src/index.ts` -- additive optional
   `notifyWebhookUrl?: string | null` field on `Project`. Flagging this file
   touch per protocol -- other tasks may also touch shared types.
5. `apps/web/components/BuilderSidePanel.tsx` -- additive settings field
   (Settings tab) to view/edit the per-project webhook URL override, saved
   via a new `PATCH /projects/:id/notify-webhook` route (kept separate from
   `/spec` since this isn't part of `SiteSpecification`). Flagging this file
   touch per protocol.
6. `apps/agent/.env.example` -- new `NOTIFY_WEBHOOK_URL` var (additive).
7. `README.md` -- "What's implemented" addition.
8. Tests: `tests/unit/agent/notifications/notifier.test.ts` and
   `webhook.test.ts` -- payload shape on READY/ERROR, retry-then-give-up on
   failure (mocked global `fetch`), and that nothing thrown escapes the
   pipeline-facing call.

## Cross-file-ownership flags (per protocol step 5)

- `apps/agent/src/engine/orchestrator.ts`: two small additions only (one
  call each at the READY and ERROR terminal transitions), no control-flow
  changes.
- `packages/shared/src/index.ts`: one new optional field on `Project`.
- `apps/web/components/BuilderSidePanel.tsx`: additive UI block inside
  `SettingsTab`, no existing markup changed.

## Log

- 2026-09-07: Started. Read docs/ARCHITECTURE.md, orchestrator.ts (terminal
  states are `READY` on success and `ERROR` on the catch path), packages/
  shared Project shape, apps/agent/.env.example conventions, engine/errors.ts
  (retry pattern to reuse), routes/projects.ts + apps/web/lib/api.ts +
  BuilderSidePanel.tsx's SettingsTab (integration points). Wrote this status
  file; implementation next.
