import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { projectsRouter } from "./routes/projects.js";
import { messagesRouter } from "./routes/messages.js";
import { themesRouter } from "./routes/themes.js";
import { contentRouter } from "./routes/content.js";
import { initStore } from "./db/store.js";
import { pickProvider } from "./llm/client.js";
import { requireApiKey } from "./middleware/auth.js";

// Minimal .env loader (apps/agent/.env, see .env.example) so ANTHROPIC_API_KEY
// (or GEMINI_API_KEY / GROQ_API_KEY) can be set without pulling in a dotenv
// dependency for one file.
function loadEnvFile() {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const [, key, rawValue = ""] = match;
    if (!(key in process.env)) process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
loadEnvFile();

// Defense in depth: a route handler with a missed `try/catch` around an
// `await` (see routes/messages.ts's PRV-04 handler for a real example this
// caught during development) otherwise takes the *entire* server down --
// Node treats an unhandled rejection as fatal by default since v15. Route
// handlers should still catch their own errors and respond properly; this
// is the backstop for the one that doesn't, not a substitute for it.
process.on("unhandledRejection", (reason) => {
  console.error("[agent] unhandled rejection (recovered):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[agent] uncaught exception (recovered):", err);
});

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

app.use("/projects", projectsRouter);
app.use("/projects", messagesRouter);
app.use("/projects", themesRouter);
app.use("/projects", contentRouter);

const PORT = Number(process.env.PORT ?? 4001);
await initStore();
app.listen(PORT, () => {
  console.log(`[agent] listening on http://localhost:${PORT}`);
  const provider = pickProvider();
  console.log(
    `[agent] AI mode: ${provider ? `${provider}-assisted` : "heuristic (set ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY to enable AI)"}`,
  );
});
