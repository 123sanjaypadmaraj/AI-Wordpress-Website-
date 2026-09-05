import type { ProjectState } from "@ai-wp/shared";

// Collapses the fine-grained generation state machine (section 33) down to
// the coarse display states the dashboard uses (section 5): Planning,
// Generating, Installing, Configuring, Testing, Ready, Error, Stopped.
const DISPLAY: Record<ProjectState, { label: string; className: string }> = {
  CREATED: { label: "Planning", className: "bg-surface-alt text-ink-muted" },
  REQUIREMENTS: { label: "Planning", className: "bg-surface-alt text-ink-muted" },
  SPECIFICATION_READY: { label: "Planning", className: "bg-surface-alt text-ink-muted" },
  THEME_SELECTION: { label: "Planning", className: "bg-surface-alt text-ink-muted" },
  ENVIRONMENT_CREATING: { label: "Installing", className: "bg-amber-100 text-amber-800" },
  WORDPRESS_READY: { label: "Installing", className: "bg-amber-100 text-amber-800" },
  THEME_INSTALLING: { label: "Installing", className: "bg-amber-100 text-amber-800" },
  PLUGINS_INSTALLING: { label: "Installing", className: "bg-amber-100 text-amber-800" },
  GENERATING: { label: "Generating", className: "bg-amber-100 text-amber-800" },
  CONFIGURING: { label: "Configuring", className: "bg-amber-100 text-amber-800" },
  TESTING: { label: "Testing", className: "bg-blue-100 text-blue-800" },
  VISUAL_REVIEW: { label: "Testing", className: "bg-blue-100 text-blue-800" },
  READY: { label: "Ready", className: "bg-emerald-100 text-emerald-800" },
  ERROR: { label: "Error", className: "bg-rose-100 text-rose-800" },
  STOPPED: { label: "Stopped", className: "bg-surface-alt text-ink-muted" },
};

export function StatusBadge({ status }: { status: ProjectState }) {
  const info = DISPLAY[status] ?? { label: status, className: "bg-surface-alt text-ink-muted" };
  return <span className={`status-pill ${info.className}`}>{info.label}</span>;
}
