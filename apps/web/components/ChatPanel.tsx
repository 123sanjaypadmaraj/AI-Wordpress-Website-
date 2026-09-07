"use client";

import { useEffect, useRef, useState } from "react";
import type { Message, Project } from "@ai-wp/shared";
import { api } from "@/lib/api";

const POST_BUILD_STATES = new Set(["READY", "ERROR", "STOPPED"]);

export function ChatPanel({
  project,
  onProjectUpdate,
}: {
  project: Project;
  onProjectUpdate: (p: Project) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listMessages(project.id).then(setMessages);
  }, [project.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // PRV-05: stream over SSE when the browser supports it (all evergreen
  // browsers do); fall back to the plain request/response endpoint
  // otherwise so nothing breaks in an unusual environment.
  async function send(text: string) {
    if (!text.trim() || sending) return;
    setSending(true);
    setInput("");
    setStreamingText("");
    setSendError(null);

    if (typeof window === "undefined" || !("EventSource" in window)) {
      try {
        const { project: updated, messages: turn } = await api.sendMessage(project.id, text);
        setMessages((m) => [...m, ...turn]);
        onProjectUpdate(updated);
      } catch (e) {
        // Don't leave the user staring at a reset input with no idea their
        // message never went anywhere -- surface it and give the text back.
        setSendError(e instanceof Error ? e.message : "Could not reach the agent server.");
        setInput(text);
      } finally {
        setSending(false);
      }
      return;
    }

    await new Promise<void>((resolve) => {
      const es = new EventSource(api.streamUrl(project.id, text));
      let settled = false;
      const cleanup = () => {
        es.close();
        setSending(false);
        setStreamingText("");
        resolve();
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
      };
      // Same dead-end as above, but for a mid-stream disconnect: the browser
      // fires a plain `error` event (no reason) any time the connection
      // drops before a "done" event closes it out cleanly -- flaky wifi, the
      // agent server restarting, a proxy timeout. Previously this silently
      // reset the composer with no explanation and quietly discarded
      // whatever had streamed in so far.
      const fail = () => {
        if (settled) return;
        settled = true;
        setSendError(
          "Lost connection to the agent server while generating a response. Your message wasn't saved -- try sending it again.",
        );
        setInput(text);
        cleanup();
      };

      es.addEventListener("user_message", (e) => {
        const msg = JSON.parse((e as MessageEvent).data) as Message;
        setMessages((m) => [...m, msg]);
      });
      es.addEventListener("delta", (e) => {
        const { text: chunk } = JSON.parse((e as MessageEvent).data) as { text: string };
        setStreamingText((t) => t + chunk);
      });
      es.addEventListener("done", (e) => {
        const { project: updated, message } = JSON.parse((e as MessageEvent).data) as {
          project: Project;
          message: Message;
        };
        setMessages((m) => [...m, message]);
        onProjectUpdate(updated);
        finish();
      });
      es.onerror = () => fail();
    });
  }

  const showUndo = POST_BUILD_STATES.has(project.status) && project.checkpoints?.some((c) => c.kind === "auto");

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-surface">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-ink-muted">
            Tell the AI what you&apos;re building -- e.g. &quot;A website for a college robotics club, with
            event registration and a project showcase.&quot;
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-accent text-white" : "bg-surface-alt text-ink"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.choices && m.choices.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.choices.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => send(c.label)}
                      className="rounded-full border border-accent/30 bg-surface px-2.5 py-1 text-xs text-accent hover:bg-accent-soft"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg bg-surface-alt px-3 py-2 text-sm text-ink">
              <p className="whitespace-pre-wrap">{streamingText}</p>
            </div>
          </div>
        )}
        {sending && !streamingText && <p className="text-xs text-ink-muted">AI is thinking…</p>}
        <div ref={bottomRef} />
      </div>
      {sendError && (
        <div role="alert" className="mx-3 mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {sendError}
        </div>
      )}
      {showUndo && (
        <div className="border-t border-border px-3 pt-2">
          <button
            onClick={() => send("undo that")}
            disabled={sending}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-ink-muted hover:border-accent hover:text-accent disabled:opacity-40"
            title="Restores the state from before the last chat-driven change (PRV-06)"
          >
            ↺ Undo last change
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-border p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe what you need, or ask for a change…"
          aria-label="Message"
          className="flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
