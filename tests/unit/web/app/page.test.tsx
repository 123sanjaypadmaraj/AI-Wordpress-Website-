import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectSummary } from "@ai-wp/shared";
import { checkA11y } from "../a11y";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    duplicateProject: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import DashboardPage from "@/app/page";

function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "p1",
    name: "Robotics Club Site",
    status: "READY",
    theme: "twentytwentyfour",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wpPort: 8081,
    ...overrides,
  };
}

function projectCard(name: string): HTMLElement {
  return screen.getByText(name).closest(".rounded-xl") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DashboardPage", () => {
  it("shows a loading state before projects arrive, not a blank screen", () => {
    vi.mocked(api.listProjects).mockReturnValue(new Promise(() => {})); // never resolves
    render(<DashboardPage />);
    expect(screen.getByText(/loading projects/i)).toBeInTheDocument();
  });

  it("shows the empty state when there are no projects yet", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([]);
    render(<DashboardPage />);
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });

  it("shows a reachable error when the agent server can't be reached", async () => {
    vi.mocked(api.listProjects).mockRejectedValue(new Error("fetch failed"));
    render(<DashboardPage />);
    expect(await screen.findByText(/fetch failed/i)).toBeInTheDocument();
    expect(screen.getByText(/dev:agent/i)).toBeInTheDocument();
  });

  it("renders a mix of project statuses, including in-progress and failed builds", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([
      summary({ id: "p1", name: "Ready Site", status: "READY" }),
      summary({ id: "p2", name: "Building Site", status: "GENERATING", wpPort: null, theme: null }),
      summary({ id: "p3", name: "Broken Site", status: "ERROR", wpPort: null }),
    ]);
    render(<DashboardPage />);

    expect(await screen.findByText("Ready Site")).toBeInTheDocument();
    expect(screen.getByText("Building Site")).toBeInTheDocument();
    expect(screen.getByText("Broken Site")).toBeInTheDocument();

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Generating")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();

    // No theme selected yet is shown for the still-building project.
    expect(screen.getByText("No theme selected yet")).toBeInTheDocument();

    // Only the project with a live wpPort gets a Preview link.
    expect(screen.getAllByText("Preview")).toHaveLength(1);
  });

  it("creates a project and navigates to it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listProjects).mockResolvedValue([]);
    vi.mocked(api.createProject).mockResolvedValue({ id: "new-1" } as never);
    render(<DashboardPage />);
    await screen.findByText(/no projects yet/i);

    await user.type(screen.getByPlaceholderText(/name this project/i), "My New Site");
    await user.click(screen.getByRole("button", { name: /new project/i }));

    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith("My New Site"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/projects/new-1"));
  });

  it("does not delete a project when the confirmation is declined", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listProjects).mockResolvedValue([summary()]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DashboardPage />);

    await screen.findByText("Robotics Club Site");
    await user.click(within(projectCard("Robotics Club Site")).getByRole("button", { name: /delete/i }));

    expect(api.deleteProject).not.toHaveBeenCalled();
  });

  it("deletes a project and refreshes the list when confirmed", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listProjects).mockResolvedValue([summary()]);
    vi.mocked(api.deleteProject).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DashboardPage />);

    await screen.findByText("Robotics Club Site");
    await user.click(within(projectCard("Robotics Club Site")).getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith("p1"));
    expect(api.listProjects).toHaveBeenCalledTimes(2); // initial + post-delete refresh
  });

  it("duplicates a project", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listProjects).mockResolvedValue([summary()]);
    vi.mocked(api.duplicateProject).mockResolvedValue({} as never);
    render(<DashboardPage />);

    await screen.findByText("Robotics Club Site");
    await user.click(within(projectCard("Robotics Club Site")).getByRole("button", { name: /duplicate/i }));

    await waitFor(() => expect(api.duplicateProject).toHaveBeenCalledWith("p1"));
  });

  it("has no accessibility violations in its loaded state", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([summary(), summary({ id: "p2", name: "Second Site", status: "ERROR" })]);
    const { container } = render(<DashboardPage />);
    await screen.findByText("Robotics Club Site");
    await screen.findByText("Second Site");
    await checkA11y(container);
  });

  it("has no accessibility violations in its empty state", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([]);
    const { container } = render(<DashboardPage />);
    await screen.findByText(/no projects yet/i);
    await checkA11y(container);
  });
});
