# Architecture (current state)

This describes what's actually wired up in `apps/` and `packages/` today,
as a concrete instance of the target architecture in `spec.md` section 4.
Updated alongside the P0/P1 backlog push -- see the published backlog
artifact linked from the PR/commit for what's still open (mostly P2 polish).

```
apps/web (Next.js)                 apps/agent (Express)
  Dashboard  ───────────────GET /projects──────────▶  projects router
  Chat panel ─────POST /projects/:id/messages           │
  (SSE: GET .../messages/stream)                        │
                              ┌─────────────────────────┴──────────────────────┐
                              │ status in {CREATED..THEME_SELECTION}?          │
                              ▼                                                ▼
                    engine/requirements.ts                       engine/editIntent.ts
                    (heuristics, or Claude                       classify -> EditIntent
                     if ANTHROPIC_API_KEY set)                   (add/remove page, change
                              │                                   color/style, add feature,
                    buildSiteSpecification()                     restart, undo)
                              │                                                │
                    engine/themes.ts (catalog +                  engine/incremental.ts
                    live wordpress.org search,                   applies exactly ONE
                    THM-04, + THM-05 variants)                    targeted tool call via
  Theme picker ──POST /themes/select {slug,variantId}             the dispatcher -- never
                              │                                    a full rebuild (GEN-09)
                    engine/orchestrator.ts
                    (fire-and-forget; project.log +
                     project.status polled by the UI)
                              │
              ┌───────────────┼────────────────────────────────────┐
              ▼               ▼                                    ▼
    docker/compose.ts   tools/dispatcher.ts ◀── every tool call from
    renders + runs      (SEC-03/05/06: permission                  both the pipeline above
    per-project          tiers, theme/plugin                       AND the chat/incremental
    docker-compose.yml   allowlists, audit log)                    path goes through here
    under infrastructure/       │
    docker/projects/<id>/       ├─▶ tools/wordpress.ts   (WP-CLI: pages, menus, theme)
                                 ├─▶ tools/plugins.ts      (PLG-01/02/03: allowlist,
                                 │                          feature->plugin map, per-
                                 │                          plugin configuration)
                                 ├─▶ tools/childtheme.ts   (GEN-06/07: generates + ships
                                 │                          a child theme applying
                                 │                          spec.design as real CSS)
                                 └─▶ tools/screenshot.ts   (TST-03: Playwright capture)

    engine/templates.ts + engine/copywriter.ts (GEN-03/04/05): section-level
    Gutenberg block templates (hero/features/stats/cta/pricing/team/...)
    filled with heuristic or Claude-generated copy, composed per page type.

    engine/testRunner.ts (TST-01/02) + engine/critic.ts (TST-03/04): a
    Playwright smoke suite (page loads, nav resolves, forms, console errors)
    and a screenshot + AI/heuristic visual critique run automatically during
    the TESTING/VISUAL_REVIEW states, with one bounded auto-fix retry.

    tools/checkpoint.ts (VER-02/03/04): auto-checkpoints (spec snapshot + DB
    dump) before every chat-driven edit and after the initial build, plus
    on-demand full DB+files backups. "Undo" in chat restores the latest one.

    tools/export.ts (EXP-01/02): zips WXR content export + the generated
    child theme + a reproducible docker-compose.yml + setup instructions.

  Live preview  ◀──────────────────────────────── docker.previewUrl (iframe)
  Progress tab  ◀──────────────────────────────── project.log (polled)
  History tab   ◀──── checkpoints / backups / audit log (VER-*, SEC-05)
```

## Persistence: JSON file by default, Postgres when configured (FND-06)

`apps/agent/src/db/store.ts` is still the single module every route goes
through. It now has two backing modes behind the same synchronous
`store.getProject`/`saveProject`/... API every caller already used:

- No `DATABASE_URL`: an in-memory cache mirrored to a JSON file, unchanged
  from the original zero-dependency behavior.
- `DATABASE_URL` set: `initStore()` (awaited once at boot, in `server.ts`,
  before the server starts accepting requests) loads every project/message
  from Postgres into the same in-memory cache. Every write updates the
  cache immediately (so call sites stay synchronous) and fires an async
  upsert to Postgres. If Postgres isn't reachable at boot, it falls back to
  the JSON file rather than failing to start.

This is a read-through cache + write-behind design, not a fully async
Postgres client -- the tradeoff that kept ~20 existing synchronous call
sites (routes, the orchestrator, the dispatcher, checkpoints, incremental
edits) unchanged. A local Postgres for development is available via
`infrastructure/docker/postgres/docker-compose.yml`.

## Tool layer coverage (spec section 16)

`tools/wordpress.ts` (pages, menus, theme install/activate, core install),
`tools/plugins.ts` (allowlisted plugin install + per-plugin configuration),
`tools/childtheme.ts` (child-theme generation/activation), and
`tools/screenshot.ts` (Playwright capture) now implement everything in the
`ToolName` contract that a generated site actually needs. `run_wp_cli` is
implemented as a passthrough restricted to a safe WP-CLI subcommand
allowlist (`post`, `option`, `theme`, `plugin`, `menu`, `core`, `cache`,
`transient`) -- destructive one-off operations, not a general shell.
`run_wordpress_api` (calling the REST API directly, as opposed to WP-CLI)
remains unimplemented; nothing in the current pipeline needs it yet.

## Every tool call goes through one dispatcher (SEC-03/05/06)

`tools/dispatcher.ts` is the only thing that calls into `tools/wordpress.ts`
and `tools/plugins.ts` from outside the pipeline's own bootstrap steps. For
every call it: enforces the `TOOL_PERMISSIONS` tier (a `"destructive"` tool
is rejected without explicit confirmation), enforces theme/plugin source
allowlists (`engine/themes.ts`'s catalog + live-discovered wordpress.org
slugs; `tools/plugins.ts`'s `ALLOWED_PLUGINS`), wraps the call in
`engine/errors.ts`'s bounded retry (transient Docker/WP-CLI failures get
retried; fatal ones don't), and appends a redacted entry to
`project.auditLog` (`SEC-05`, readable via `GET /projects/:id/audit-log`
and the web UI's History tab) -- regardless of whether the call came from
the initial build, a chat-driven edit, or a plugin install.

## Chat after the site exists is real edits, not spec re-extraction (PRV-04/GEN-09)

Before a build exists, a chat turn runs `engine/requirements.ts` (unchanged
in spirit from the original heuristic/Claude slot-filling). Once a project
has been built (`READY`/`ERROR`/`STOPPED`), a turn instead runs through
`engine/editIntent.ts` (classify into one small structured `EditIntent`)
and `engine/incremental.ts` (apply exactly that one change via the
dispatcher, snapshotting an auto-checkpoint first). "Add a pricing page"
creates one page and updates the menu; it does not re-run the pipeline.
The same incremental path is what `PATCH /projects/:id/spec` (the
Requirements tab's inline edit form, REQ-06) uses post-build, so editing
the form and asking in chat are two entry points into one code path.

## Trust boundary

The AI agent never gets a shell. `engine/orchestrator.ts` and
`engine/incremental.ts` both go through `tools/dispatcher.ts`, which calls
named functions in `tools/wordpress.ts`/`tools/plugins.ts`, which shell out
to WP-CLI *inside the project's own `wpcli` container* via
`docker compose exec` -- never against the host, never against another
project's container (enforced by the per-project Compose project name and
network in `docker/compose.ts`). Generated admin credentials are written to
a project-scoped `.env` file on disk and read back only by
`tools/wordpress.ts`; they're never included in any API response the
frontend or an LLM prompt sees, and exports (`tools/export.ts`) deliberately
leave them out too -- a re-deployed bundle gets fresh, randomly generated
credentials from the compose template, never the originals.

## Known environment gotchas (found via end-to-end testing, now fixed)

- The `wpcli` container needs `restart: unless-stopped` like the other two
  services -- it originally had none, so it silently stayed down after a
  Docker Desktop restart while `wordpress`/`db` came back, and every
  WP-CLI call failed with `service "wpcli" is not running` until someone
  ran `docker compose up` by hand.
- `WORDPRESS_CONFIG_EXTRA` (used to raise `WP_MEMORY_LIMIT`, since PHP's
  stock 128M isn't enough for some plugins run via WP-CLI) is read fresh
  per-process from that container's own environment, not baked once into
  the shared `wp-config.php` -- it has to be set on **both** the
  `wordpress` and `wpcli` services in the compose template, not just the
  one that first generates the file.
- A child theme's `Template:` header in `style.css` must be the parent
  theme's directory slug (e.g. `neve`), not its display name (`Neve`) --
  WordPress won't activate a child theme otherwise.
