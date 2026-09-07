---
state: in-progress
owner: 11-demo-readiness
started: 2026-09-07T00:00:00Z
summary: Building a one-command `npm run demo` path (heuristic mode, no API key) that drives a canned restaurant-site build end to end through the real engine (requirements -> theme selection -> Docker build -> smoke tests -> visual critic), plus DEMO_SCRIPT.md for a live 5-8 minute walkthrough.
---

## Plan

- `apps/agent/scripts/demo-seed.ts`: calls the engine functions directly
  (`engine/requirements.ts`, `engine/themes.ts`, `engine/designSystem.ts`,
  `engine/orchestrator.ts`) in-process rather than driving the HTTP API --
  avoids needing the agent server up, AGENT_API_KEY, or apps/web running.
  Uses the same JSON-file `store` module the real server uses (calls
  `initStore()` first) so the resulting project shows up in the normal UI
  too if someone starts `npm run dev:agent` / `npm run dev:web` afterward.
- Canned conversation: a small restaurant site ("Bellavista Trattoria")
  with a menu + reservations page, run through
  `engine/requirements.ts`'s heuristic slot-filling turn by turn (matches
  `NEXT_QUESTIONS` order) until `specReady`, then theme
  recommendation + selection (mirroring `routes/themes.ts`'s
  `POST /:id/themes/select` logic) and `runGenerationPipeline` awaited
  directly (this already runs the smoke suite + visual critic as part of
  VISUAL_REVIEW -- no separate step needed).
- Root `package.json`: additive `"demo": "tsx apps/agent/scripts/demo-seed.ts"`
  script (workspace deps already resolve `tsx`/`@ai-wp/shared` etc. since
  it runs from repo root with workspaces installed).
- `DEMO_SCRIPT.md`: live-presentation walkthrough (chat -> theme pick with
  wp.org search/variants -> build -> one chat edit + undo -> Content tab
  AI-edit box -> export), ~5-8 minutes, at repo root.

## Log

- Read README.md, docs/ARCHITECTURE.md, server.ts (auth middleware),
  routes/{projects,messages,themes}.ts, engine/{requirements,themes,
  orchestrator,designSystem,critic}.ts, tools/{screenshot,wordpress,
  dispatcher,plugins}.ts, db/store.ts, docker/compose.ts, and the web UI
  (BuilderSidePanel.tsx, ChatPanel.tsx, dashboard page.tsx) to map the exact
  click-path DEMO_SCRIPT.md needs to describe.
- Docker confirmed reachable in this environment (Docker Desktop 28.1.1,
  compose v2.35.1, other projects' containers already running) -- full
  end-to-end run including the Docker-dependent build step is in scope, not
  just the heuristic pre-build logic.
- `npm install` completed at repo root.
