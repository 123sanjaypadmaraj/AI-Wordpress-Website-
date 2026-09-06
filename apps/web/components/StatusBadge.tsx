import type { ProjectState } from "@ai-wp/shared";

// Collapses the fine-grained generation state machine (section 33) down to
// the coarse display states the dashboard uses (section 5): Planning,
// Generating, Installing, Configuring, Testing, Ready, Error, Stopped.
const DISPLAY: Record<ProjectState, { label: string; className: string }> = {
  CREATED: { label: "Planning", className: "bg-surface-alt text-ink-muted" },
  REQUIREMENTS: { label: "Planning", className: "bg-surface-alt text-ink-muted" },
  SPECIFICATION_READY: { label: "Planning", className: "bg-surface-alt text-ink-muted" },
  THEME_SELECTION: { label: "Planning", className: "bg-surface-alt text-ink-muted" },
  ENVIRONMENT_CREATING: { label: "Installing", className: "bg-amber-500/15 text-amber-300" },
  WORDPRESS_READY: { label: "Installing", className: "bg-amber-500/15 text-amber-300" },
  THEME_INSTALLING: { label: "Installing", className: "bg-amber-500/15 text-amber-300" },
  PLUGINS_INSTALLING: { label: "Installing", className: "bg-amber-500/15 text-amber-300" },
  GENERATING: { label: "Generating", className: "bg-amber-500/15 text-amber-300" },
  CONFIGURING: { label: "Configuring", className: "bg-amber-500/15 text-amber-300" },
  TESTING: { label: "Testing", className: "bg-blue-500/15 text-blue-300" },
  VISUAL_REVIEW: { label: "Testing", className: "bg-blue-500/15 text-blue-300" },
  READY: { label: "Ready", className: "bg-emerald-500/15 text-emerald-300" },
  ERROR: { label: "Error", className: "bg-rose-500/15 text-rose-300" },
  STOPPED: { label: "Stopped", className: "bg-surface-alt text-ink-muted" },
};

export function StatusBadge({ status }: { status: ProjectState }) {
  const info = DISPLAY[status] ?? { label: status, className: "bg-surface-alt text-ink-muted" };
  return <span className={`status-pill ${info.className}`}>{info.label}</span>;
}
