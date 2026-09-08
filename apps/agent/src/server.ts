import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { initStore } from "./db/store.js";
import { pickProvider } from "./llm/client.js";

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

// createApp() (src/app.ts, task 06) builds the Express app with no side
// effects of its own -- split out so tests can import it via supertest
// without starting a real listener or touching the store. Everything below
// is process-level wiring specific to actually running the server.
const app = createApp();

const PORT = Number(process.env.PORT ?? 4001);
await initStore();
app.listen(PORT, () => {
  console.log(`[agent] listening on http://localhost:${PORT}`);
  const provider = pickProvider();
  console.log(
    `[agent] AI mode: ${provider ? `${provider}-assisted` : "heuristic (set ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY to enable AI)"}`,
  );
});
