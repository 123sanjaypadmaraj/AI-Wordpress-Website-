import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Message, Project } from "@ai-wp/shared";
import { makeProject } from "../fixtures";
import { checkA11y } from "../a11y";

vi.mock("@/lib/api", () => ({
  api: {
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    // PRV-05 (via SEC-02's same-origin proxy): ChatPanel builds the
    // EventSource URL through this rather than a raw agentUrl string -- see
    // apps/web/lib/api.ts.
    streamUrl: (id: string, text: string) =>
      `/api/agent/projects/${id}/messages/stream?text=${encodeURIComponent(text)}`,
  },
}));

import { api } from "@/lib/api";
import { ChatPanel } from "@/components/ChatPanel";

// jsdom has no EventSource -- ChatPanel checks `"EventSource" in window` to
// decide whether to stream, so leaving it undefined (the default) exercises
// the plain request/response fallback; SSE tests install this fake.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners: Record<string, Array<(e: MessageEvent) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const cb of this.listeners[type] ?? []) cb(event);
  }

  triggerNetworkError() {
    this.onerror?.();
  }
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    projectId: "proj-1",
    role: "assistant",
    text: "Hi! What are you building?",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeEventSource.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatPanel", () => {
  it("shows a starter prompt when there are no messages yet", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([]);
    render(<ChatPanel project={makeProject()} onProjectUpdate={vi.fn()} />);
    expect(await screen.findByText(/tell the ai what you're building/i)).toBeInTheDocument();
  });

  it("loads and renders existing message history", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([
      message({ id: "m1", role: "user", text: "A site for a robotics club" }),
      message({ id: "m2", role: "assistant", text: "Great, what pages do you need?" }),
    ]);
    render(<ChatPanel project={makeProject()} onProjectUpdate={vi.fn()} />);
    expect(await screen.findByText("A site for a robotics club")).toBeInTheDocument();
    expect(screen.getByText("Great, what pages do you need?")).toBeInTheDocument();
  });

  it("renders reply choices as clickable buttons", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listMessages).mockResolvedValue([
      message({ choices: [{ label: "Portfolio", value: "portfolio" }, { label: "Business", value: "business" }] }),
    ]);
    vi.mocked(api.sendMessage).mockResolvedValue({ project: makeProject(), messages: [] });
    render(<ChatPanel project={makeProject()} onProjectUpdate={vi.fn()} />);

    const choiceButton = await screen.findByRole("button", { name: "Portfolio" });
    await user.click(choiceButton);
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith("proj-1", "Portfolio"));
  });

  describe("without SSE support (fallback path)", () => {
    it("sends a message and renders the response via plain request/response", async () => {
      const user = userEvent.setup();
      const onProjectUpdate = vi.fn();
      vi.mocked(api.listMessages).mockResolvedValue([]);
      const updated = makeProject({ status: "SPECIFICATION_READY" });
      vi.mocked(api.sendMessage).mockResolvedValue({
        project: updated,
        messages: [message({ id: "u1", role: "user", text: "Build me a bakery site" })],
      });
      render(<ChatPanel project={makeProject()} onProjectUpdate={onProjectUpdate} />);
      await screen.findByText(/tell the ai what you're building/i);

      await user.type(screen.getByLabelText("Message"), "Build me a bakery site");
      await user.click(screen.getByRole("button", { name: "Send" }));

      expect(await screen.findByText("Build me a bakery site")).toBeInTheDocument();
      await waitFor(() => expect(onProjectUpdate).toHaveBeenCalledWith(updated));
    });

    it("surfaces an error and keeps the message text when the request fails", async () => {
      const user = userEvent.setup();
      vi.mocked(api.listMessages).mockResolvedValue([]);
      vi.mocked(api.sendMessage).mockRejectedValue(new Error("agent unreachable"));
      render(<ChatPanel project={makeProject()} onProjectUpdate={vi.fn()} />);
      await screen.findByText(/tell the ai what you're building/i);

      await user.type(screen.getByLabelText("Message"), "Build me a bakery site");
      await user.click(screen.getByRole("button", { name: "Send" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("agent unreachable");
      // The user's text comes back so they don't have to retype it.
      expect(screen.getByLabelText("Message")).toHaveValue("Build me a bakery site");
    });
  });

  describe("with SSE support (streaming path)", () => {
    beforeEach(() => {
      vi.stubGlobal("EventSource", FakeEventSource);
    });

    it("renders streamed deltas as they arrive, then the final message", async () => {
      const user = userEvent.setup();
      const onProjectUpdate = vi.fn();
      vi.mocked(api.listMessages).mockResolvedValue([]);
      render(<ChatPanel project={makeProject()} onProjectUpdate={onProjectUpdate} />);
      await screen.findByText(/tell the ai what you're building/i);

      await user.type(screen.getByLabelText("Message"), "A bakery site");
      await user.click(screen.getByRole("button", { name: "Send" }));

      const es = FakeEventSource.instances[0];
      expect(es).toBeDefined();
      expect(es.url).toContain("/projects/proj-1/messages/stream");

      es.emit("user_message", message({ id: "u1", role: "user", text: "A bakery site" }));
      expect(await screen.findByText("A bakery site")).toBeInTheDocument();

      es.emit("delta", { text: "Great, " });
      es.emit("delta", { text: "what pages do you need?" });
      expect(await screen.findByText("Great, what pages do you need?")).toBeInTheDocument();

      const updated = makeProject({ status: "SPECIFICATION_READY" });
      es.emit("done", { project: updated, message: message({ id: "a1", text: "Great, what pages do you need?" }) });

      await waitFor(() => expect(onProjectUpdate).toHaveBeenCalledWith(updated));
      expect(es.closed).toBe(true);
      // The streaming bubble is cleared once the real message lands, so the
      // text isn't rendered twice.
      await waitFor(() => expect(screen.getAllByText("Great, what pages do you need?")).toHaveLength(1));
    });

    it("shows an error and restores the input on a mid-stream disconnect, instead of a silent dead end", async () => {
      const user = userEvent.setup();
      vi.mocked(api.listMessages).mockResolvedValue([]);
      render(<ChatPanel project={makeProject()} onProjectUpdate={vi.fn()} />);
      await screen.findByText(/tell the ai what you're building/i);

      await user.type(screen.getByLabelText("Message"), "A bakery site");
      await user.click(screen.getByRole("button", { name: "Send" }));

      const es = FakeEventSource.instances[0];
      es.emit("delta", { text: "Partial rep" });
      es.triggerNetworkError();

      expect(await screen.findByRole("alert")).toHaveTextContent(/lost connection/i);
      expect(screen.getByLabelText("Message")).toHaveValue("A bakery site");
      expect(es.closed).toBe(true);
      // Composer is usable again, not stuck in a permanent "sending" state.
      expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
    });

    it("does not show a stale error after a disconnect once a later send succeeds", async () => {
      const user = userEvent.setup();
      vi.mocked(api.listMessages).mockResolvedValue([]);
      render(<ChatPanel project={makeProject()} onProjectUpdate={vi.fn()} />);
      await screen.findByText(/tell the ai what you're building/i);

      await user.type(screen.getByLabelText("Message"), "first try");
      await user.click(screen.getByRole("button", { name: "Send" }));
      FakeEventSource.instances[0].triggerNetworkError();
      await screen.findByRole("alert");

      await user.clear(screen.getByLabelText("Message"));
      await user.type(screen.getByLabelText("Message"), "second try");
      await user.click(screen.getByRole("button", { name: "Send" }));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("shows the undo control once there's an auto checkpoint to undo, and sends 'undo that'", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listMessages).mockResolvedValue([]);
    vi.mocked(api.sendMessage).mockResolvedValue({ project: makeProject(), messages: [] });
    const project = makeProject({
      status: "READY",
      checkpoints: [
        {
          id: "cp1",
          projectId: "proj-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          label: "before edit",
          kind: "auto",
          spec: makeProject().spec,
          dbDumpFile: "dump.sql",
        },
      ],
    });
    render(<ChatPanel project={project} onProjectUpdate={vi.fn()} />);

    const undoButton = await screen.findByRole("button", { name: /undo last change/i });
    await user.click(undoButton);
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith("proj-1", "undo that"));
  });

  it("has no accessibility violations with messages and an error banner shown", async () => {
    vi.mocked(api.listMessages).mockResolvedValue([message()]);
    vi.mocked(api.sendMessage).mockRejectedValue(new Error("agent unreachable"));
    const user = userEvent.setup();
    const { container } = render(<ChatPanel project={makeProject()} onProjectUpdate={vi.fn()} />);
    await screen.findByText(message().text);

    await user.type(screen.getByLabelText("Message"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");

    await checkA11y(container);
  });
});
