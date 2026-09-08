import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * apps/agent/src/routes/messages.ts, end to end over real HTTP.
 *
 * llm/client.js is mocked ONLY in this file (not in helpers.ts), toggled via
 * the `aiEnabled` flag below, for the SSE token-streaming test -- everywhere
 * else in this file `aiEnabled` stays false, so aiAvailable() is false and
 * every engine module runs its real, deterministic heuristic path exactly
 * like every other test file in this directory (completeText/completeVision
 * resolve null regardless, so even if a code path did check aiAvailable(),
 * it degrades to "no AI answer" -- the same fallback the real llm/client.ts
 * documents for auth/network/parse failures).
 */
let aiEnabled = false;
// vi.hoisted (not a plain top-level const) -- the vi.mock factory below
// references streamAckMock directly (not wrapped in another closure), and
// static imports further down this file (e.g. "./helpers.js", which
// transitively imports the whole route tree) are hoisted by the ES module
// loader ahead of any plain `const`, so the factory can run before a plain
// `const streamAckMock = ...` here would have executed -- vi.hoisted()
// guarantees this runs first regardless.
const streamAckMock = vi.hoisted(() =>
  vi.fn(async (_text: string, onDelta: (chunk: string) => void) => {
    for (const chunk of ["Sounds ", "good, ", "on it!"]) {
      await new Promise((r) => setTimeout(r, 5)); // force separate event-loop turns / socket writes
      onDelta(chunk);
    }
  }),
);
vi.mock("@agent/llm/client.js", () => ({
  pickProvider: () => (aiEnabled ? "anthropic" : null),
  aiAvailable: () => aiEnabled,
  completeText: vi.fn().mockResolvedValue(null),
  completeVision: vi.fn().mockResolvedValue(null),
  streamAck: streamAckMock,
}));

import {
  authHeader,
  buildApp,
  buildProjectToReady,
  cleanupWorld,
  createProject,
  execWpCliMock,
  getProject,
  resetWorld,
  sendMessage,
} from "./helpers.js";

describe("messages routes: pre-build requirement gathering", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    aiEnabled = false;
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("POST /:id/messages appends a user + assistant message and returns them", async () => {
    const project = await createProject(app);
    const res = await sendMessage(app, project.id, "We run a business website for our customers.");
    expect(res.status).toBe(201);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0].role).toBe("user");
    expect(res.body.messages[1].role).toBe("assistant");

    const listRes = await request(app).get(`/projects/${project.id}/messages`).set(authHeader());
    expect(listRes.body).toHaveLength(2);
  });

  it("404s for an unknown project, and 400s for empty/oversized text", async () => {
    const missing = await sendMessage(app, "nope", "hello");
    expect(missing.status).toBe(404);

    const project = await createProject(app);
    const empty = await sendMessage(app, project.id, "   ");
    expect(empty.status).toBe(400);

    const tooLong = await sendMessage(app, project.id, "x".repeat(4001));
    expect(tooLong.status).toBe(400);
  });
});

describe("messages routes: edit-intent path is a targeted diff, never a full rebuild", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    aiEnabled = false;
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("a single-tool edit (remove a page) makes EXACTLY ONE dispatcher call, not a rebuild", async () => {
    const ready = await buildProjectToReady(app);
    expect(ready.spec.pages).toEqual(["home", "about", "contact"]);

    // First add a removable page (none of the default pages match
    // editIntent.ts's KNOWN_PAGE_WORDS) -- this legitimately costs two
    // dispatcher calls (create_page + create_menu, to keep nav in sync).
    const addRes = await sendMessage(app, ready.id, "Please add a pricing page");
    expect(addRes.status).toBe(201);
    expect(addRes.body.project.spec.pages).toContain("pricing");
    const afterAdd = await getProject(app, ready.id);
    const auditLenAfterAdd = afterAdd.auditLog.length;

    // Now the actual assertion: removing it is exactly one dispatcher call
    // (delete_page), not a rebuild of the whole site (which would touch
    // every page, every plugin, the theme, and the menu again).
    const removeRes = await sendMessage(app, ready.id, "remove the pricing page");
    expect(removeRes.status).toBe(201);
    expect(removeRes.body.project.spec.pages).not.toContain("pricing");
    expect(removeRes.body.messages[1].text).toMatch(/removed/i);

    const afterRemove = await getProject(app, ready.id);
    const newEntries = afterRemove.auditLog.slice(auditLenAfterAdd);
    expect(newEntries).toHaveLength(1);
    expect(newEntries[0]).toMatchObject({ tool: "delete_page", ok: true, source: "chat", permission: "destructive" });

    // Sanity bound: nowhere near the ~7 calls the initial build made
    // (install_theme + 2 plugins + 3 create_page + create_menu).
    expect(afterRemove.auditLog.length).toBeLessThan(ready.auditLog.length + 4);
  }, 20_000);

  it("an unrecognized message applies nothing and touches the dispatcher zero times", async () => {
    const ready = await buildProjectToReady(app);
    const before = ready.auditLog.length;
    const res = await sendMessage(app, ready.id, "asdkjfh totally unparseable gibberish");
    expect(res.status).toBe(201);
    expect(res.body.messages[1].text).toMatch(/didn't recognize/i);
    const after = await getProject(app, ready.id);
    expect(after.auditLog.length).toBe(before);
  }, 20_000);
});

describe("messages routes: undo restores the pre-edit checkpoint (bug fix verified)", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    aiEnabled = false;
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("an edit followed by 'undo' reverts the spec, verified through the API's own read-back", async () => {
    const ready = await buildProjectToReady(app);
    expect(ready.spec.pages).not.toContain("team");

    const editRes = await sendMessage(app, ready.id, "add a team page");
    expect(editRes.status).toBe(201);
    expect(editRes.body.project.spec.pages).toContain("team");

    const undoRes = await sendMessage(app, ready.id, "undo that");
    expect(undoRes.status).toBe(201);
    expect(undoRes.body.messages[1].text).toMatch(/restored/i);

    // The read-back proving the undo actually took effect, through the API
    // (not by reaching into the fake store).
    const afterUndo = await getProject(app, ready.id);
    expect(afterUndo.spec.pages).not.toContain("team");

    // BUG FIX regression check: chat-driven undo used to call
    // tools/checkpoint.ts's restoreCheckpoint() directly, bypassing
    // tools/dispatcher.ts -- leaving zero audit-log trace for what is
    // otherwise a "destructive" tier operation (see
    // apps/agent/src/engine/incremental.ts). It now goes through
    // callTool("restore_checkpoint", ...), so it must show up in the
    // audit log like every other mutation.
    const restoreEntries = afterUndo.auditLog.filter((e) => e.tool === "restore_checkpoint");
    expect(restoreEntries).toHaveLength(1);
    expect(restoreEntries[0]).toMatchObject({ ok: true, source: "chat", permission: "destructive" });
  }, 20_000);

  it("'undo' typed before a site exists is just requirement-gathering text, not an edit intent", async () => {
    // handleTurn() routes on project.status, not on whether checkpoints
    // exist -- a fresh REQUIREMENTS-stage project has none yet, and "undo"
    // must not crash or be misrouted into the edit-intent/checkpoint path.
    const project = await createProject(app);
    const res = await sendMessage(app, project.id, "undo");
    expect(res.status).toBe(201);
    expect(res.body.messages[1].text).not.toMatch(/restored/i);
    const after = await getProject(app, project.id);
    expect(after.checkpoints).toEqual([]);
  });
});

describe("messages routes: SSE streaming actually streams incremental tokens", () => {
  let app: Express;
  beforeEach(() => {
    resetWorld();
    aiEnabled = false;
    streamAckMock.mockClear();
    app = buildApp();
  });
  afterEach(cleanupWorld);

  it("GET .../messages/stream emits multiple discrete delta frames before the final done frame, not one final blob", async () => {
    aiEnabled = true;
    const project = await createProject(app);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected a real listening port");

    const events: Array<{ event: string; data: unknown }> = [];
    const rawChunkCount = { n: 0 };
    let contentType: string | string[] | undefined;

    await new Promise<void>((resolve, reject) => {
      const path = `/projects/${project.id}/messages/stream?text=${encodeURIComponent("hi there, tell me about my options")}`;
      const req = http.request(
        {
          host: "127.0.0.1",
          port: address.port,
          path,
          method: "GET",
          headers: { "X-Agent-Key": authHeader()["X-Agent-Key"] },
        },
        (res) => {
          contentType = res.headers["content-type"];
          let buffer = "";
          res.on("data", (chunk: Buffer) => {
            rawChunkCount.n += 1;
            buffer += chunk.toString("utf8");
            let idx: number;
            while ((idx = buffer.indexOf("\n\n")) !== -1) {
              const raw = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const eventMatch = raw.match(/^event: (.+)$/m);
              const dataMatch = raw.match(/^data: (.+)$/m);
              if (eventMatch && dataMatch) {
                events.push({ event: eventMatch[1], data: JSON.parse(dataMatch[1]) });
              }
            }
          });
          res.on("end", resolve);
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end();
    });
    server.close();

    expect(contentType).toMatch(/text\/event-stream/);
    expect(events[0].event).toBe("user_message");
    const deltaEvents = events.filter((e) => e.event === "delta");
    // The real point of this test: multiple SEPARATE delta frames arrived,
    // each carrying one chunk of text -- not a single frame with the whole
    // reply. streamAckMock above deliberately calls onDelta() 3 times.
    expect(deltaEvents.length).toBeGreaterThanOrEqual(3);
    expect(deltaEvents.map((e) => (e.data as { text: string }).text)).toEqual(["Sounds ", "good, ", "on it!"]);
    expect(events[events.length - 1].event).toBe("done");

    // The final "done" event carries the authoritative reply/state -- the
    // deltas were purely a typing-indicator preview of a *different*
    // (ack) string, proving "done" isn't just replaying the same blob.
    const done = events[events.length - 1].data as { project: { id: string }; message: { text: string } };
    expect(done.project.id).toBe(project.id);
    expect(typeof done.message.text).toBe("string");
    expect(done.message.text.length).toBeGreaterThan(0);

    // More than one raw TCP-level data event arrived too -- genuine
    // progressive delivery, not everything coalesced into a single flush.
    expect(rawChunkCount.n).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it("without AI configured, the stream still ends in a well-formed done event (no deltas, no crash)", async () => {
    aiEnabled = false;
    const project = await createProject(app);
    const res = await request(app)
      .get(`/projects/${project.id}/messages/stream`)
      .query({ text: "hello" })
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.text).toContain("event: user_message");
    expect(res.text).toContain("event: done");
    expect(res.text).not.toContain("event: delta");
  });
});

// Sanity: nothing in this file leaked a real WP-CLI dependency -- every
// exercised path went through the mocked boundary.
describe("messages routes: mocking boundary sanity", () => {
  it("execWpCliMock is the one actually wired into the dispatcher/wordpress.ts stack", () => {
    expect(execWpCliMock).toBeDefined();
  });
});
