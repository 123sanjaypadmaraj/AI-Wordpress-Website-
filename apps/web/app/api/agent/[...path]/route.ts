import { NextRequest } from "next/server";

/**
 * SEC-hardening: apps/agent now requires an `X-Agent-Key` header (see
 * apps/agent/src/middleware/auth.ts) and that key must never reach a
 * browser -- a `NEXT_PUBLIC_*` env var is bundled into client JS and would
 * hand the secret to every visitor. Client components used to call
 * apps/agent directly (fetch + EventSource against `NEXT_PUBLIC_AGENT_URL`);
 * they now call this same-origin route instead, which holds the real key
 * server-side and forwards everything -- including the SSE chat stream and
 * binary export/screenshot downloads -- through to the real agent.
 *
 * This also restores the CORS story: with the browser only ever talking to
 * its own origin, apps/agent's CORS restriction to WEB_ORIGIN
 * (apps/agent/src/server.ts) is a same-origin server-to-server call away,
 * not something the browser needs to negotiate at all.
 */

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4001";
const AGENT_API_KEY = process.env.AGENT_API_KEY;

// Hop-by-hop headers a proxy must not forward verbatim (RFC 7230 6.1),
// plus a couple Next.js/undici need to compute fresh for the new request.
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "accept-encoding",
]);
const STRIP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

async function proxy(req: NextRequest, pathSegments: string[]): Promise<Response> {
  const target = new URL(`${AGENT_URL}/${pathSegments.map(encodeURIComponent).join("/")}`);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  if (AGENT_API_KEY) headers.set("x-agent-key", AGENT_API_KEY);

  const hasBody = !["GET", "HEAD"].includes(req.method);
  let agentRes: Response;
  try {
    agentRes = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // Required by undici/Next's fetch when streaming a request body.
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
      cache: "no-store",
    } as RequestInit & { duplex?: "half" });
  } catch {
    return Response.json({ error: "The agent service is unreachable." }, { status: 502 });
  }

  const resHeaders = new Headers();
  agentRes.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) resHeaders.set(key, value);
  });

  // SSE (routes/messages.ts's /messages/stream) relies on the body reaching
  // the browser as it arrives, not once fully buffered -- passing the
  // ReadableStream straight through (rather than awaiting .text()/.json())
  // keeps that true here too.
  return new Response(agentRes.body, { status: agentRes.status, headers: resHeaders });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
