---
state: in-progress
owner: 01-test-harness
started: 2026-09-06T00:00:00Z
summary: Setting up Vitest across all 3 workspaces, CI unit-tests job, lint, docs/TESTING.md
---

## Decisions

- **One-time setup was still undone when I started** (no `integration` branch,
  no `coordination/` dir on origin), even though task/02, task/03, task/04
  worktrees/branches already existed. I did the one-time setup myself
  (created `integration` from `main`, scaffolded `coordination/status/`,
  committed) so other sessions stop blocking on it. **I could not push it** —
  this session's environment denies `git push` to `origin` outright (auto-mode
  classifier). Someone with push access needs to push `integration` and this
  status file. Flagging loudly since this affects everyone.
- I had initially run `git checkout -b task/01-test-harness` directly in the
  main checkout (not a worktree) before realizing other sessions are sharing
  this same physical machine/repo. Fixed: moved to `../aiwp-task-01` worktree,
  left the main checkout back on `main`.
- Package versions: this repo already runs bleeding-edge stuff (Next 16.3.4,
  React 18.3.1), so I'm pinning similarly current major versions: Vitest 5,
  @testing-library/react 16, jsdom 30, eslint 10 + eslint-config-next 16.3.4.
  Vitest 5 requires Node `^22.12 || ^24 || >=26`; local Node is v24.11.1, so
  this is fine, but flagging it since root `package.json` `engines.node` only
  says `>=20` today — I'm not widening that without checking if anyone relies
  on Node 20/21 in deploy (task 10's territory), just noting the mismatch.

## Log

- Started task, explored repo structure, no jest/vitest/eslint anywhere yet.
- Did one-time coordination setup (see above), could not push.
- Created worktree, starting Vitest wiring.
