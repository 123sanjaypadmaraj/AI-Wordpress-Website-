import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CmsPageDetail, CmsPageSummary, ThemeRecommendation } from "@ai-wp/shared";
import { makeProject } from "../fixtures";
import { checkA11y } from "../a11y";

vi.mock("@/lib/api", () => ({
  api: {
    selectTheme: vi.fn(),
    updateSpec: vi.fn(),
    listPages: vi.fn(),
    getPage: vi.fn(),
    savePage: vi.fn(),
    aiDraftPage: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import { BuilderSidePanel } from "@/components/BuilderSidePanel";

beforeEach(() => {
  vi.clearAllMocks();
});

function recommendation(overrides: Partial<ThemeRecommendation> = {}): ThemeRecommendation {
  return {
    theme: {
      slug: "astra",
      name: "Astra",
      category: ["business"],
      styleTags: ["minimal"],
      blockThemeCompatible: true,
      maturity: 0.9,
      requiredPlugins: [],
      description: "A fast, lightweight multipurpose theme.",
    },
    score: 87,
    reasons: ["Matches your minimal style preference", "Widely used for business sites"],
    source: "catalog",
    ...overrides,
  };
}

describe("BuilderSidePanel", () => {
  describe("Requirements tab", () => {
    function renderRequirements() {
      const onProjectUpdate = vi.fn();
      const project = makeProject({ status: "REQUIREMENTS" });
      project.spec.site.type = "portfolio";
      project.spec.site.audience = ["students", "faculty"];
      project.spec.pages = ["home", "about"];
      project.spec.features = ["contact-form"];
      project.spec.design.style = "minimal";
      const utils = render(<BuilderSidePanel project={project} onProjectUpdate={onProjectUpdate} />);
      return { ...utils, project, onProjectUpdate };
    }

    function pagesGroup() {
      return screen.getByRole("group", { name: "Pages" });
    }

    it("renders the current spec values", () => {
      renderRequirements();
      expect(screen.getByLabelText(/website type/i)).toHaveValue("portfolio");
      expect(screen.getByLabelText(/audience/i)).toHaveValue("students, faculty");
      expect(within(pagesGroup()).getByRole("button", { name: "home" })).toHaveAttribute("aria-pressed", "true");
      expect(within(pagesGroup()).getByRole("button", { name: "about" })).toHaveAttribute("aria-pressed", "true");
      expect(within(pagesGroup()).getByRole("button", { name: "blog" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("group", { name: "Features" })).toHaveTextContent("contact-form");
      expect(screen.getByRole("button", { name: "contact-form" })).toHaveAttribute("aria-pressed", "true");
    });

    it("disables Save until a field actually changes", async () => {
      const user = userEvent.setup();
      renderRequirements();
      const save = screen.getByRole("button", { name: /save changes/i });
      expect(save).toBeDisabled();

      await user.click(within(pagesGroup()).getByRole("button", { name: "blog" }));
      expect(save).toBeEnabled();
    });

    it("saves the patched spec and shows what was applied", async () => {
      const user = userEvent.setup();
      const updatedProject = makeProject({ status: "REQUIREMENTS" });
      vi.mocked(api.updateSpec).mockResolvedValue({
        project: updatedProject,
        applied: ["Added a blog page."],
      });
      const { onProjectUpdate } = renderRequirements();

      await user.click(within(pagesGroup()).getByRole("button", { name: "blog" }));
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(api.updateSpec).toHaveBeenCalled());
      const [, patch] = vi.mocked(api.updateSpec).mock.calls[0];
      expect(patch.pages).toEqual(["home", "about", "blog"]);
      expect(await screen.findByText("Added a blog page.")).toBeInTheDocument();
      expect(onProjectUpdate).toHaveBeenCalledWith(updatedProject);
    });

    it("handles a plain-Project response (no `applied` list) as a generic save", async () => {
      const user = userEvent.setup();
      const updatedProject = makeProject({ status: "REQUIREMENTS" });
      vi.mocked(api.updateSpec).mockResolvedValue(updatedProject);
      renderRequirements();

      await user.click(within(pagesGroup()).getByRole("button", { name: "blog" }));
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      expect(await screen.findByText("Saved.")).toBeInTheDocument();
    });

    it("shows the live-edit note only once the site is built", async () => {
      const user = userEvent.setup();
      const readyProject = makeProject({ status: "READY" });
      const { rerender } = render(<BuilderSidePanel project={readyProject} onProjectUpdate={vi.fn()} />);
      // READY defaults to the Preview tab (see BuilderSidePanel's own
      // auto-jump effect) -- switch back to Requirements to check its note.
      await user.click(screen.getByRole("tab", { name: "Requirements" }));
      expect(screen.getByText(/site is already built/i)).toBeInTheDocument();

      rerender(<BuilderSidePanel project={makeProject({ status: "REQUIREMENTS" })} onProjectUpdate={vi.fn()} />);
      expect(screen.queryByText(/site is already built/i)).not.toBeInTheDocument();
    });

    it("has no accessibility violations", async () => {
      const { container } = renderRequirements();
      await checkA11y(container);
    });
  });

  describe("Themes tab", () => {
    it("prompts to finish requirements first when there are no recommendations yet", () => {
      render(<BuilderSidePanel project={makeProject({ status: "THEME_SELECTION" })} onProjectUpdate={vi.fn()} />);
      expect(screen.getByText(/finish the requirements conversation/i)).toBeInTheDocument();
    });

    it("renders theme recommendations with score, reasons, and a wp.org badge for live results", () => {
      const project = makeProject({
        status: "THEME_SELECTION",
        themeRecommendations: [recommendation(), recommendation({
          theme: { ...recommendation().theme, slug: "hestia", name: "Hestia" },
          source: "wordpress.org",
          score: 72,
        })],
      });
      render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);

      expect(screen.getByText("Astra")).toBeInTheDocument();
      expect(screen.getByText("87%")).toBeInTheDocument();
      expect(screen.getAllByText(/Matches your minimal style preference/)).toHaveLength(2);
      expect(screen.getByText("Hestia")).toBeInTheDocument();
      expect(screen.getByText("wp.org")).toBeInTheDocument();
      // The catalog-sourced recommendation has no such badge.
      expect(screen.getAllByText("wp.org")).toHaveLength(1);
    });

    it("renders THM-05 design variants and toggles a selection", async () => {
      const user = userEvent.setup();
      const project = makeProject({
        status: "THEME_SELECTION",
        themeRecommendations: [
          recommendation({
            variants: [
              { id: "bold", label: "Bold", primary_color: "#111111", secondary_color: "#222222", mode: "dark", heading_font: "Inter", body_font: "Inter", radius: "sharp", preset: "bold" },
              { id: "soft", label: "Soft", primary_color: "#eeeeee", secondary_color: "#dddddd", mode: "light", heading_font: "Inter", body_font: "Inter", radius: "pill", preset: "minimal" },
            ],
          }),
        ],
      });
      render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);

      expect(screen.getByText("Design variant (THM-05)")).toBeInTheDocument();
      const boldButton = screen.getByRole("button", { name: /bold/i });
      await user.click(boldButton);
      expect(boldButton.className).toMatch(/border-accent/);
    });

    it("selects a theme (with the chosen variant) and jumps to the Progress tab", async () => {
      const user = userEvent.setup();
      const onProjectUpdate = vi.fn();
      const updated = makeProject({ status: "ENVIRONMENT_CREATING" });
      vi.mocked(api.selectTheme).mockResolvedValue(updated);
      const project = makeProject({
        status: "THEME_SELECTION",
        themeRecommendations: [
          recommendation({
            variants: [{ id: "bold", label: "Bold", primary_color: "#111", secondary_color: "#222", mode: "dark", heading_font: "Inter", body_font: "Inter", radius: "sharp", preset: "bold" }],
          }),
        ],
      });
      render(<BuilderSidePanel project={project} onProjectUpdate={onProjectUpdate} />);

      await user.click(screen.getByRole("button", { name: /bold/i }));
      await user.click(screen.getByRole("button", { name: /select this theme/i }));

      await waitFor(() => expect(api.selectTheme).toHaveBeenCalledWith("proj-1", "astra", "bold"));
      expect(onProjectUpdate).toHaveBeenCalledWith(updated);
      expect(await screen.findByText("Build pipeline")).toBeInTheDocument();
    });

    it("falls back to an initial-letter tile when a theme has no screenshot", () => {
      const project = makeProject({ status: "THEME_SELECTION", themeRecommendations: [recommendation()] });
      render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);
      expect(screen.getByText("A", { selector: "div" })).toBeInTheDocument();
    });

    it("has no accessibility violations", async () => {
      const project = makeProject({
        status: "THEME_SELECTION",
        themeRecommendations: [recommendation({
          variants: [{ id: "bold", label: "Bold", primary_color: "#111", secondary_color: "#222", mode: "dark", heading_font: "Inter", body_font: "Inter", radius: "sharp", preset: "bold" }],
        })],
      });
      const { container } = render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);
      await checkA11y(container);
    });
  });

  describe("Progress tab (build pipeline + log)", () => {
    it("marks earlier steps done and the current one active while a build is in progress", () => {
      const project = makeProject({ status: "GENERATING" });
      render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);

      const pluginsStep = screen.getByText("Theme + plugins installed").closest("li")!;
      expect(within(pluginsStep).getByText("✓")).toBeInTheDocument();

      const pagesStep = screen.getByText("Pages generated").closest("li")!;
      expect(within(pagesStep).getByText("●")).toBeInTheDocument();

      const readyStep = screen.getByText("Ready").closest("li")!;
      expect(within(readyStep).getByText("○")).toBeInTheDocument();
    });

    it("shows 'no activity yet' rather than a blank log before anything has happened", () => {
      render(<BuilderSidePanel project={makeProject({ status: "CREATED", log: [] })} onProjectUpdate={vi.fn()} />);
      expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
    });

    it("renders log entries, color-coded by level", () => {
      const project = makeProject({
        status: "GENERATING",
        log: [
          { id: "l1", projectId: "proj-1", timestamp: "2026-01-01T00:00:00.000Z", message: "Starting build", level: "info" },
          { id: "l2", projectId: "proj-1", timestamp: "2026-01-01T00:00:01.000Z", message: "Slow plugin install", level: "warn" },
          { id: "l3", projectId: "proj-1", timestamp: "2026-01-01T00:00:02.000Z", message: "wp-cli exited 1", level: "error" },
        ],
      });
      render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);

      expect(screen.getByText(/starting build/i).className).toMatch(/text-ink-muted/);
      expect(screen.getByText(/slow plugin install/i).className).toMatch(/text-amber-400/);
      expect(screen.getByText(/wp-cli exited 1/i).className).toMatch(/text-rose-400/);
    });

    it("shows a distinct alert on a failed build instead of a checklist that looks like nothing happened", () => {
      const project = makeProject({
        status: "ERROR",
        log: [{ id: "l1", projectId: "proj-1", timestamp: "2026-01-01T00:00:00.000Z", message: "wp-cli exited 1", level: "error" }],
      });
      render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);
      expect(screen.getByRole("alert")).toHaveTextContent(/build failed/i);
    });

    it("shows every step complete when a fully-built site's environment is stopped", () => {
      const project = makeProject({ status: "STOPPED" });
      render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);
      const readyStep = screen.getByText("Ready").closest("li")!;
      expect(within(readyStep).getByText("✓")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("has no accessibility violations on a failed build", async () => {
      const project = makeProject({
        status: "ERROR",
        log: [{ id: "l1", projectId: "proj-1", timestamp: "2026-01-01T00:00:00.000Z", message: "wp-cli exited 1", level: "error" }],
      });
      const { container } = render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);
      await checkA11y(container);
    });
  });

  describe("Content tab", () => {
    function page(overrides: Partial<CmsPageSummary> = {}): CmsPageSummary {
      return { id: 1, title: "Home", slug: "home", status: "publish", ...overrides };
    }

    async function openContentTab(dockerStatus: "running" | "stopped" = "running") {
      const user = userEvent.setup();
      const project = makeProject({ status: "READY", docker: { ...makeProject().docker, status: dockerStatus } });
      const utils = render(<BuilderSidePanel project={project} onProjectUpdate={vi.fn()} />);
      await user.click(screen.getByRole("tab", { name: "Content" }));
      return { user, project, ...utils };
    }

    it("tells the user to start the environment when it isn't running", async () => {
      await openContentTab("stopped");
      expect(screen.getByText(/start the environment/i)).toBeInTheDocument();
    });

    it("lists pages and shows a friendly empty state", async () => {
      vi.mocked(api.listPages).mockResolvedValue([]);
      await openContentTab();
      expect(await screen.findByText(/no pages yet/i)).toBeInTheDocument();
    });

    it("surfaces a list error rather than a blank pages column", async () => {
      vi.mocked(api.listPages).mockRejectedValue(new Error("wp-cli unreachable"));
      await openContentTab();
      expect(await screen.findByText(/wp-cli unreachable/i)).toBeInTheDocument();
    });

    it("loads a page into the editor, edits it, and saves", async () => {
      vi.mocked(api.listPages).mockResolvedValue([page()]);
      vi.mocked(api.getPage).mockResolvedValue({ ...page(), content: "<p>Hello</p>" } as CmsPageDetail);
      vi.mocked(api.savePage).mockResolvedValue({ ...page(), title: "Home page", content: "<p>Hi there</p>" } as CmsPageDetail);
      const { user } = await openContentTab();

      await user.click(await screen.findByRole("button", { name: "Home" }));
      const titleInput = await screen.findByLabelText("Title");
      expect(titleInput).toHaveValue("Home");
      const saveButton = screen.getByRole("button", { name: /save changes/i });
      expect(saveButton).toBeDisabled();

      await user.clear(titleInput);
      await user.type(titleInput, "Home page");
      expect(saveButton).toBeEnabled();

      await user.click(saveButton);
      await waitFor(() => expect(api.savePage).toHaveBeenCalledWith("proj-1", 1, { title: "Home page", content: "<p>Hello</p>" }));
      expect(await screen.findByText(/saved to the live site/i)).toBeInTheDocument();
    });

    it("shows a save error without discarding the user's edits", async () => {
      vi.mocked(api.listPages).mockResolvedValue([page()]);
      vi.mocked(api.getPage).mockResolvedValue({ ...page(), content: "<p>Hello</p>" } as CmsPageDetail);
      vi.mocked(api.savePage).mockRejectedValue(new Error("checkpoint failed"));
      const { user } = await openContentTab();

      await user.click(await screen.findByRole("button", { name: "Home" }));
      const titleInput = await screen.findByLabelText("Title");
      await user.clear(titleInput);
      await user.type(titleInput, "New title");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      expect(await screen.findByText(/checkpoint failed/i)).toBeInTheDocument();
      expect(titleInput).toHaveValue("New title");
    });

    it("drafts content with AI and fills the editor for review without saving automatically", async () => {
      vi.mocked(api.listPages).mockResolvedValue([page()]);
      vi.mocked(api.getPage).mockResolvedValue({ ...page(), content: "<p>Hello</p>" } as CmsPageDetail);
      vi.mocked(api.aiDraftPage).mockResolvedValue({ title: "Home", content: "<p>A warmer welcome.</p>" });
      const { user } = await openContentTab();

      await user.click(await screen.findByRole("button", { name: "Home" }));
      await screen.findByLabelText("Title");
      await user.type(screen.getByLabelText(/ask ai to edit this page/i), "make it warmer");
      await user.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(() => expect(api.aiDraftPage).toHaveBeenCalledWith("proj-1", 1, "make it warmer"));
      expect(await screen.findByDisplayValue("<p>A warmer welcome.</p>")).toBeInTheDocument();
      expect(api.savePage).not.toHaveBeenCalled();
    });

    it("shows a draft error when the AI edit fails", async () => {
      vi.mocked(api.listPages).mockResolvedValue([page()]);
      vi.mocked(api.getPage).mockResolvedValue({ ...page(), content: "<p>Hello</p>" } as CmsPageDetail);
      vi.mocked(api.aiDraftPage).mockRejectedValue(new Error("no AI provider configured"));
      const { user } = await openContentTab();

      await user.click(await screen.findByRole("button", { name: "Home" }));
      await screen.findByLabelText("Title");
      await user.type(screen.getByLabelText(/ask ai to edit this page/i), "make it warmer");
      await user.click(screen.getByRole("button", { name: /generate/i }));

      expect(await screen.findByText(/no ai provider configured/i)).toBeInTheDocument();
    });

    it("has no accessibility violations while editing a page", async () => {
      vi.mocked(api.listPages).mockResolvedValue([page()]);
      vi.mocked(api.getPage).mockResolvedValue({ ...page(), content: "<p>Hello</p>" } as CmsPageDetail);
      const { user, container } = await openContentTab();
      await user.click(await screen.findByRole("button", { name: "Home" }));
      await screen.findByLabelText("Title");
      await checkA11y(container);
    });
  });
});
