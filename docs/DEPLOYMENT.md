# Deployment

This is a two-service app, and the two services deploy to different kinds of
hosts:

| Service | What it needs | Where it can run |
| --- | --- | --- |
| `apps/web` | Static/serverless Next.js, no server state | **Vercel** |
| `apps/agent` | Docker socket access (spins up a WordPress container per project via WP-CLI), optionally Postgres, optionally Playwright for screenshots/smoke tests | A host with Docker: a VPS, a Fly.io/Railway machine, an EC2/Droplet, etc. -- **not Vercel** (serverless functions have no Docker access) |

## apps/web on Vercel

1. In the Vercel dashboard, create a project from this repo and set
   **Root Directory** to `apps/web`. `apps/web/vercel.json` handles the
   rest (it `cd`s back to the workspace root to install/build so the
   `packages/shared` workspace dependency resolves correctly).
2. Set the environment variable **`NEXT_PUBLIC_AGENT_URL`** to the public
   URL of your deployed `apps/agent` instance (see `apps/web/.env.example`).
   Without it, the deployed site falls back to `http://localhost:4001`,
   which won't exist in production.
3. Set **`AGENT_API_KEY`** to the same value as `apps/agent`'s
   `AGENT_API_KEY` below. This is a server-only variable (do NOT prefix it
   `NEXT_PUBLIC_`) -- the browser never talks to `apps/agent` directly, it
   calls apps/web's own `app/api/agent/[...path]` route, which attaches this
   key server-side and proxies the request through. See docs/SECURITY.md.
4. Deploy. `npm run build -w packages/shared -w apps/web` is the build
   command; it does not touch `apps/agent`.

## apps/agent

Deploy this to any host that gives the process a Docker socket (it shells
out to `docker compose` per project -- see `infrastructure/docker/`). Set:

- `PORT` (defaults to 4001)
- `DATABASE_URL` (optional -- omit to use the zero-config JSON file store)
- `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` (optional -- set
  one to enable AI assistance, omit all to fall back to local heuristics;
  see `apps/agent/src/llm/client.ts` and `AI_PROVIDER` if more than one is set)
- **`WEB_ORIGIN`**: set this to your deployed `apps/web` URL once it's known.
  CORS used to be wide open (`app.use(cors())`, any origin) -- it's now
  restricted to exactly this one origin, defaulting to
  `http://localhost:3000` for local dev. (Resolved: this section used to
  flag the wide-open CORS as a TODO.)
- **`AGENT_API_KEY`**: set this to a real random secret before deploying
  anywhere reachable beyond your own machine. Every route except `/health`
  now requires it (as an `X-Agent-Key` header) -- previously there was no
  authentication at all, and every route has Docker-socket-level power. See
  docs/SECURITY.md for the full threat model and what this does and doesn't
  protect against.
