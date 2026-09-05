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
3. Deploy. `npm run build -w packages/shared -w apps/web` is the build
   command; it does not touch `apps/agent`.

## apps/agent

Deploy this to any host that gives the process a Docker socket (it shells
out to `docker compose` per project -- see `infrastructure/docker/`). Set:

- `PORT` (defaults to 4001)
- `DATABASE_URL` (optional -- omit to use the zero-config JSON file store)
- `ANTHROPIC_API_KEY` (optional -- omit to fall back to local heuristics)

`apps/agent` currently allows CORS from any origin (`app.use(cors())` in
`apps/agent/src/server.ts`). Once the Vercel URL is known, consider
restricting that to just your deployed web origin.
