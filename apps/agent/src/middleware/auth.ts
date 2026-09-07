import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const HEADER = "x-agent-key";

/**
 * Minimal shared-secret auth: every route (mounted after this middleware in
 * server.ts -- /health is registered before it, so it stays open) requires
 * an `X-Agent-Key` header matching `AGENT_API_KEY`. This is not a real
 * user-auth system (see docs/SECURITY.md) -- it's the floor above "any
 * request from anyone reaches Docker/WP-CLI", not a ceiling.
 *
 * If AGENT_API_KEY is unset, auth is skipped entirely (matches this repo's
 * "nothing is required to run the agent" local-dev default -- see
 * apps/agent/.env.example) but a loud warning is logged once at startup in
 * server.ts so this never silently ships unauthenticated.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const configured = process.env.AGENT_API_KEY;
  if (!configured) return next();

  const provided = req.header(HEADER);
  if (!provided || !safeEqual(provided, configured)) {
    return res.status(401).json({ error: "Unauthorized: missing or invalid X-Agent-Key header" });
  }
  next();
}

// Plain `===` on secrets leaks timing information proportional to how many
// leading bytes match; timingSafeEqual needs equal-length buffers first.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
