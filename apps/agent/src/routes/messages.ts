import { Router } from "express";
import { nanoid } from "nanoid";
import type { ChatChoice, Message, Project } from "@ai-wp/shared";
import { store } from "../db/store.js";
import { runRequirementTurn, buildSiteSpecification } from "../engine/requirements.js";
import { recommendThemes } from "../engine/themes.js";
import { buildDesignSystem } from "../engine/designSystem.js";
import { classifyEditIntent } from "../engine/editIntent.js";
import { applyEditIntent } from "../engine/incremental.js";
import { aiAvailable, streamAck } from "../llm/client.js";
import { chatMessageLimiter } from "../middleware/rateLimit.js";

export const messagesRouter = Router();

const PRE_BUILD_STATES = new Set(["CREATED", "REQUIREMENTS", "SPECIFICATION_READY"]);

// Every chat turn can reach an AI provider (see handleTurn -> engine/*.ts ->
// llm/client.ts) -- an unbounded body is an easy way to run up real token
// cost against this endpoint, so cap it well above anything a real chat
// message needs.
const MAX_MESSAGE_LENGTH = 4000;

interface TurnResult {
  replyText: string;
  choices?: ChatChoice[];
}

/**
 * PRV-04/GEN-09: shared by both the plain POST endpoint and the SSE stream
 * below, so "how a chat turn is interpreted" has exactly one implementation.
 * Before a build exists, a turn is requirement gathering (spec section 7).
 * Once a site exists, a turn is a targeted edit -- classified into one
 * EditIntent and applied via the incremental applier, never a full re-run.
 */
async function handleTurn(project: Project, text: string): Promise<TurnResult> {
  if (PRE_BUILD_STATES.has(project.status)) {
    const result = await runRequirementTurn(text, project.slots);
    project.slots = result.slots;
    project.spec = buildSiteSpecification(project.name, project.slots);

    if (result.specReady && project.status === "REQUIREMENTS") {
      project.status = "SPECIFICATION_READY";
      // GEN-10: upgrade the heuristic design-system pick (requirements.ts)
      // with an AI-informed one now that the full spec is known -- a no-op
      // heuristic-preserving call when no provider is configured. Before the
      // theme variants below are built, so THM-05's swatches reflect it.
      project.spec.design = { ...project.spec.design, ...(await buildDesignSystem(project.spec)) };
      project.themeRecommendations = await recommendThemes(project.spec);
      project.status = "THEME_SELECTION";
    }
    store.saveProject(project);
    return { replyText: result.reply, choices: result.choices };
  }

  // The requirements conversation is done and a theme choice is pending --
  // that happens in the Themes tab (BuilderSidePanel), not here. Without this
  // branch THEME_SELECTION used to fall back into the requirement-gathering
  // path above (it was in PRE_BUILD_STATES): since every slot was already
  // filled, runRequirementTurn found nothing missing and just re-sent the
  // same "I have everything I need" summary forever, no matter what the user
  // typed -- "continue" never actually advanced anything. Nor should it fall
  // into the edit-intent path below; that assumes a live site to edit, which
  // doesn't exist yet at this stage.
  if (project.status === "THEME_SELECTION") {
    return { replyText: 'Pick a theme from the "Themes" tab to start the build -- there\'s nothing more to answer here yet.' };
  }

  const intent = await classifyEditIntent(text, project.spec);
  if (intent.kind === "unknown") {
    return {
      replyText:
        'I didn\'t recognize a specific change in that -- try things like "add a pricing page", ' +
        '"make it green", "add a blog", "restart the environment", or "undo that".',
    };
  }
  const result = await applyEditIntent(project, intent);
  return { replyText: result.summary || "I couldn't apply that change -- see the Progress log for details." };
}

messagesRouter.get("/:id/messages", (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(store.listMessages(project.id));
});

messagesRouter.post("/:id/messages", chatMessageLimiter, async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const text = (req.body?.text as string | undefined)?.trim();
  if (!text) return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `text must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
  }

  const now = () => new Date().toISOString();
  const userMessage: Message = { id: nanoid(10), projectId: project.id, role: "user", text, createdAt: now() };
  store.appendMessage(userMessage);

  // A chat-driven edit can fail for very ordinary reasons (Docker hiccup, a
  // WP-CLI call rejected) -- that must come back as a normal assistant
  // reply + 201, never an uncaught rejection. An async Express 4 handler
  // that throws past its last `await` does NOT get turned into a 500 for
  // you; left unhandled, Node treats it as an unhandled promise rejection
  // and (since Node 15) exits the whole process. This bit the pipeline
  // during development: a single failed tool call took the entire agent
  // server down mid-request.
  let replyText: string;
  let choices;
  try {
    ({ replyText, choices } = await handleTurn(project, text));
  } catch (err) {
    replyText = `Something went wrong applying that: ${err instanceof Error ? err.message : String(err)}`;
  }

  const assistantMessage: Message = {
    id: nanoid(10),
    projectId: project.id,
    role: "assistant",
    text: replyText,
    choices,
    createdAt: now(),
  };
  store.appendMessage(assistantMessage);

  res.status(201).json({ project: store.getProject(project.id), messages: [userMessage, assistantMessage] });
});

// PRV-05: true token streaming over SSE. EventSource only supports GET, so
// the message travels as a query param on its own endpoint rather than
// replacing the POST above -- non-streaming clients keep working unchanged.
messagesRouter.get("/:id/messages/stream", chatMessageLimiter, async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const text = (req.query.text as string | undefined)?.trim();
  if (!text) return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `text must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
  }

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const now = () => new Date().toISOString();
  const userMessage: Message = { id: nanoid(10), projectId: project.id, role: "user", text, createdAt: now() };
  store.appendMessage(userMessage);
  send("user_message", userMessage);

  // Stream the model's own phrasing token-by-token when available, purely as
  // a typing-indicator-with-content UX; the authoritative reply (and any
  // state change) is still computed by the same handleTurn() the POST
  // endpoint uses, and arrives in the final "done" event. Works with
  // whichever provider is active -- see llm/client.ts.
  if (aiAvailable()) {
    await streamAck(text, (chunk) => send("delta", { text: chunk }));
  }

  let replyText: string;
  let choices;
  try {
    ({ replyText, choices } = await handleTurn(project, text));
  } catch (err) {
    replyText = `Something went wrong applying that: ${err instanceof Error ? err.message : String(err)}`;
  }
  const assistantMessage: Message = {
    id: nanoid(10),
    projectId: project.id,
    role: "assistant",
    text: replyText,
    choices,
    createdAt: now(),
  };
  store.appendMessage(assistantMessage);
  send("done", { project: store.getProject(project.id), message: assistantMessage });
  res.end();
});
