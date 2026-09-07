import rateLimit from "express-rate-limit";

/**
 * Bounds cost/abuse on the two route groups that trigger real spend or real
 * work per request: creating a project (each one eventually spins up a
 * Docker/WordPress environment) and sending a chat message (each one can be
 * an AI-provider call -- see apps/agent/src/llm/client.ts). Deliberately not
 * applied globally: GET reads (project list, messages, audit log, etc.)
 * don't need it and shouldn't be limited alongside these.
 */
export const projectCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many projects created from this IP -- try again later." },
});

export const chatMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many chat messages -- slow down and try again shortly." },
});
