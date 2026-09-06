# AI WordPress Builder

An AI-native website builder: you describe a site in chat, the agent turns
that into a structured specification, recommends a real WordPress theme,
spins up an isolated Docker WordPress environment, and builds the site --
pages, navigation, content -- against it. Once the site exists, further
chat turns (or edits in the Requirements tab) make targeted changes to the
live site rather than rebuilding it. Full product spec:
[`docs/spec.md`](docs/spec.md), current architecture:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Engineering backlog: see
the published work-items artifact linked from the PR/commit that
introduced this repo.

## What's implemented

- Monorepo scaffold (`apps/web`, `apps/agent`, `packages/shared`), CI
  (typecheck + build on every push/PR).
- Dashboard, chat-driven requirement gathering (with e-commerce/SEO/
  accessibility/integration follow-ups), an inline requirements-edit form,
  structured site specification, theme recommendation (curated catalog +
  live wordpress.org search, with design-variant swatches to preview
  before building), and a build-progress/log view.
- A real WordPress Agent Tool Layer that shells out to WP-CLI inside a
  per-project Docker Compose stack -- not a mock -- for pages, navigation,
  theme install, plugin install/configuration, and child-theme generation.
- Every tool call (pipeline, chat-driven edit, or plugin install) goes
  through one dispatcher enforcing permission tiers, theme/plugin source
  allowlists, and a structured audit log, with a bounded retry for
  transient Docker/WP-CLI failures.
- Page content is composed from a section-level template library (hero,
  features, stats, CTA, pricing, team, testimonials) filled with AI- or
  heuristically-generated copy. Which optional sections a page like Home,
  About, or Services actually gets, and in what order, is itself an AI (or
  heuristic-fallback) layout decision -- not a one-size-fits-all template --
  and the whole thing is styled by a generated child theme applying a full
  AI-derived design system (primary + secondary color, a heading/body font
  pairing, and a corner-radius personality, not just one accent color) as
  real CSS.
- Plugins are installed and minimally configured based on the site's
  features (WooCommerce, Contact Form 7's absence noted honestly, Yoast
  SEO, MailPoet, Events Manager, WP Accessibility, caching, spam
  filtering) from a trusted allowlist -- never an arbitrary slug.
- Post-build chat edits ("add a pricing page", "make it green", "add a
  blog", "undo that") are classified into one structured intent and
  applied as a single targeted change, not a full rebuild -- with an
  automatic checkpoint before every edit and an "undo" that restores it
  (spec snapshot + real database restore).
- A Content tab (CMS-01) lists every page on the live site and lets you edit
  its title and body directly -- reading and writing straight through
  WP-CLI, so it can never drift from the real site -- plus an "Ask AI to
  edit this page" box that drafts a rewrite from a plain-English instruction
  for you to review before saving. Manual and AI-drafted saves both go
  through the same dispatcher-audited path as every other edit, with an
  automatic checkpoint first. A per-page link out to the real WordPress
  block editor covers anything the raw content view doesn't.
- An automated smoke-test suite (Playwright: page loads, nav resolves,
  forms present, no console errors) and a screenshot + AI/heuristic visual
  critique run automatically after generation, with one bounded auto-fix
  retry if the homepage looks blank.
- Full DB + wp-content backups on demand, and a project export (WXR
  content + generated child theme + a reproducible, credential-free
  docker-compose bundle) as a downloadable zip.
- Per-project Docker isolation: own network, own volumes, own allocated
  port, own CPU/memory limits.
- Requirement extraction (and now edit-intent classification) runs on
  local heuristics by default, and upgrades to a real model automatically
  when an API key is set for any supported provider -- Claude
  (`ANTHROPIC_API_KEY`), Gemini (`GEMINI_API_KEY`), or Groq (`GROQ_API_KEY`),
  see `apps/agent/src/llm/client.ts` -- including token-streamed chat
  replies over SSE and an AI-authored visual critique instead of the
  heuristic-only fallback.
- Persistence is a JSON file by default; set `DATABASE_URL` to use
  Postgres instead (a local instance is one `docker compose` away -- see
  `infrastructure/docker/postgres/`).

Remaining backlog is mostly P2 polish (live container stats, side-by-side
theme comparison, deployment-instructions generator, post-generation theme
switching) -- see the published backlog artifact for the current list.

## Running it locally

Prerequisites: Node 20+, Docker Desktop running.

```bash
npm install
npx playwright install chromium   # needed for the smoke-test/screenshot/visual-critic tools

# terminal 1
npm run dev:agent      # http://localhost:4001

# terminal 2
npm run dev:web         # http://localhost:3000
```

Open http://localhost:3000, create a project, and describe the site you
want. Once the requirements conversation is complete and you pick a theme
(and, optionally, a design variant), the agent renders a docker-compose
stack under `infrastructure/docker/projects/<id>/`, brings it up, installs
WordPress + the chosen theme + a generated child theme + any plugins the
spec calls for via WP-CLI, and generates the pages from your spec. The
Progress tab streams the pipeline log; the Preview tab embeds the live
site once it's ready. From there, keep chatting -- edits are applied
directly to the live site.

To enable AI-assisted requirement extraction, edit classification,
copywriting, and visual critique instead of the keyword/heuristic
fallbacks, set one of `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or
`GROQ_API_KEY` before starting the agent (see `apps/agent/.env.example`).
If more than one is set, `AI_PROVIDER` picks which is used.

## Repository layout

```
apps/
  web/      Next.js UI -- dashboard, chat (SSE streaming), requirements
            form, theme/variant picker, live preview, history (checkpoints/
            backups/audit log), settings/export
  agent/    AI agent server -- requirement + edit-intent + theme + copy
            engines, orchestrator, tool dispatcher (permissions/allowlists/
            audit log), WordPress/plugin/child-theme tool layer, Docker
            Compose lifecycle, checkpoint/backup/export tools
packages/
  shared/   Types shared between web and agent (site spec, project, tools,
            audit log, checkpoints/backups)
infrastructure/
  docker/
    templates/   docker-compose template rendered per project
    projects/    generated, gitignored, per-project compose + secrets +
                 checkpoints + backups + exports + screenshots
    postgres/    optional local Postgres for the application database
docs/
  spec.md          the full MVP feature specification
  ARCHITECTURE.md  what's actually wired up today, and why
tests/
  e2e/       standalone Playwright suite (`npm run test:e2e`), same
             checklist the pipeline runs automatically during TESTING
```
