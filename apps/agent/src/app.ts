import express from "express";
import cors from "cors";
import { projectsRouter } from "./routes/projects.js";
import { messagesRouter } from "./routes/messages.js";
import { themesRouter } from "./routes/themes.js";
import { contentRouter } from "./routes/content.js";
import { requireApiKey } from "./middleware/auth.js";

/**
 * Builds the Express app, with no side effects (no `listen()`, no
 * `initStore()`) -- split out of server.ts (task 06) so tests can exercise
 * the real HTTP + middleware + route stack via supertest without starting a
 * real network listener or touching the JSON-file/Postgres store. server.ts
 * is now just this factory plus the process-level wiring (env loading,
 * initStore, listen, unhandledRejection/uncaughtException).
 *
 * Reads WEB_ORIGIN/AGENT_API_KEY from process.env at call time, same as the
 * inline version this replaced -- callers (server.ts, or a test's helpers.ts)
 * that need a specific value must set the env var before calling this.
 */
export function createApp() {
  const app = express();

  // SEC: this used to be `cors()` with no origin restriction at all -- any
  // website's browser JS could call this API cross-origin (and would have
  // been able to ride along with cookies/credentials had any existed). Restrict
  // to the one origin apps/web actually runs on. WEB_ORIGIN mirrors
  // apps/web/.env.example's NEXT_PUBLIC_AGENT_URL convention: unset means "just
  // local dev", not "allow anything".
  const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  app.use(cors({ origin: WEB_ORIGIN }));
  app.use(express.json());

  // Kept open pre-auth on purpose: load balancers/orchestrators poll this
  // without a key, and it leaks nothing but a static ok/service string.
  app.get("/health", (_req, res) => res.json({ ok: true, service: "ai-wp-agent" }));

  // SEC: every route below this line has Docker-socket-level power (spin up /
  // tear down containers, run arbitrary WP-CLI against a real DB per
  // project) and, until now, had ZERO authentication -- anyone who could
  // reach this port could do any of that. See docs/SECURITY.md for what this
  // does and doesn't protect against.
  if (!process.env.AGENT_API_KEY) {
    console.warn(
      "[agent] WARNING: AGENT_API_KEY is not set -- every route is UNAUTHENTICATED. " +
        "This is fine for local-only dev; set AGENT_API_KEY before this process is reachable from anywhere else.",
    );
  }
  app.use(requireApiKey);

  // BUG FIX (found in task 06's integration-test pass): projectsRouter
  // defines `GET/DELETE /:id` -- a single-path-segment catch-all. Mounted
  // before themesRouter (as this used to be, verbatim, in the pre-refactor
  // server.ts), it silently shadowed themesRouter's `GET /catalog` (also a
  // single segment): Express matches routers/routes in registration order
  // and stops at the first one that sends a response, so every request for
  // `GET /projects/catalog` was actually handled by projectsRouter's `/:id`
  // as `store.getProject("catalog")` -- always undefined, always a 404
  // "Project not found" -- and themesRouter's real catalog handler was
  // completely unreachable. Nothing in apps/web currently calls this route
  // (grepped for "catalog" -- no hits), so this shipped silently. Every
  // other router here only defines multi-segment routes (`/:id/messages`,
  // `/:id/themes`, `/:id/pages`, etc.), so there's no other shadow -- moving
  // just themesRouter ahead of projectsRouter is the minimal fix: its
  // specific routes now get first refusal, and projectsRouter's broad
  // `/:id` only ever sees what's left.
  app.use("/projects", themesRouter);
  app.use("/projects", projectsRouter);
  app.use("/projects", messagesRouter);
  app.use("/projects", contentRouter);

  return app;
}
