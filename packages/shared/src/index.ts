/**
 * Shared types for the AI WordPress Builder.
 * This package is the contract between apps/web (Next.js) and apps/agent
 * (the AI + tool-layer server). Nothing here talks to Docker or WordPress
 * directly -- it just describes the shapes both sides agree on.
 */

// ---------------------------------------------------------------------------
// Generation state machine (spec section 33)
// ---------------------------------------------------------------------------

export const PROJECT_STATES = [
  "CREATED",
  "REQUIREMENTS",
  "SPECIFICATION_READY",
  "THEME_SELECTION",
  "ENVIRONMENT_CREATING",
  "WORDPRESS_READY",
  "THEME_INSTALLING",
  "PLUGINS_INSTALLING",
  "GENERATING",
  "CONFIGURING",
  "TESTING",
  "VISUAL_REVIEW",
  "READY",
  "ERROR",
  "STOPPED",
] as const;

export type ProjectState = (typeof PROJECT_STATES)[number];

// ---------------------------------------------------------------------------
// Site specification (spec section 8) -- the structured source of truth
// ---------------------------------------------------------------------------

export interface SiteSpecification {
  site: {
    name: string;
    type: string; // e.g. "organization", "business", "portfolio", "ecommerce"
    industry: string;
    audience: string[];
  };
  pages: string[];
  features: string[]; // e.g. "event-registration", "contact-form", "ecommerce"
  design: {
    style: string; // e.g. "minimal", "futuristic", "corporate"
    mode: "light" | "dark";
    primary_color: string;
    font: string;
  };
  theme: {
    selected: string | null;
    use_child_theme: boolean;
  };
  // REQ-07: slots that only matter for some site types, gathered as optional
  // follow-ups so they never block reaching SPECIFICATION_READY.
  ecommerce: {
    payment: string | null; // e.g. "stripe", "paypal", "woocommerce-payments"
  };
  seo: boolean;
  accessibility: boolean;
  integrations: string[]; // e.g. "google-analytics", "mailchimp"
}

export function emptySiteSpecification(name = "Untitled Project"): SiteSpecification {
  return {
    site: { name, type: "", industry: "", audience: [] },
    pages: [],
    features: [],
    design: { style: "", mode: "light", primary_color: "#3651D4", font: "Inter" },
    theme: { selected: null, use_child_theme: true },
    ecommerce: { payment: null },
    seo: false,
    accessibility: false,
    integrations: [],
  };
}

// ---------------------------------------------------------------------------
// Requirement slots the requirement-gathering agent tracks (spec section 7)
// ---------------------------------------------------------------------------

export interface RequirementSlots {
  websiteType: string | null;
  audience: string[] | null;
  pages: string[] | null;
  features: string[] | null;
  visualStyle: string | null;
  colorPreference: string | null;
  // REQ-07
  ecommercePayment: string | null;
  seo: boolean | null;
  accessibility: boolean | null;
  integrations: string[] | null;
}

export const EMPTY_SLOTS: RequirementSlots = {
  websiteType: null,
  audience: null,
  pages: null,
  features: null,
  visualStyle: null,
  colorPreference: null,
  ecommercePayment: null,
  seo: null,
  accessibility: null,
  integrations: null,
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "system";

export interface ChatChoice {
  label: string;
  value: string;
}

export interface Message {
  id: string;
  projectId: string;
  role: MessageRole;
  text: string;
  choices?: ChatChoice[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Themes (spec sections 10-12)
// ---------------------------------------------------------------------------

export interface ThemeDefinition {
  slug: string;
  name: string;
  category: string[]; // e.g. ["business", "portfolio"]
  styleTags: string[]; // e.g. ["minimal", "modern", "dark"]
  blockThemeCompatible: boolean;
  maturity: number; // 0-1, heuristic
  requiredPlugins: string[];
  description: string;
}

export interface ThemeRecommendation {
  theme: ThemeDefinition;
  score: number; // 0-100
  reasons: string[];
  source?: "catalog" | "wordpress.org"; // THM-04
  variants?: ThemeVariant[]; // THM-05
}

// THM-05: named design-system tweaks a user can preview and pick before the
// build kicks off, without standing up N separate WordPress instances.
export interface ThemeVariant {
  id: string;
  label: string;
  primary_color: string;
  mode: "light" | "dark";
  font: string;
}

// ---------------------------------------------------------------------------
// Docker environment (spec section 13)
// ---------------------------------------------------------------------------

export type DockerEnvironmentStatus =
  | "none"
  | "creating"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export interface DockerEnvironment {
  projectId: string;
  status: DockerEnvironmentStatus;
  wpPort: number | null;
  containerPrefix: string;
  previewUrl: string | null;
  adminUrl: string | null;
  createdAt: string | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Tool layer (spec section 16) -- the *names* the AI agent is allowed to call.
// Actual execution lives in apps/agent/src/tools; this is the contract.
// ---------------------------------------------------------------------------

export const TOOL_NAMES = [
  "create_project",
  "get_project_state",
  "start_wordpress",
  "stop_wordpress",
  "restart_wordpress",
  "install_theme",
  "activate_theme",
  "install_plugin",
  "activate_plugin",
  "configure_theme",
  "configure_plugin",
  "create_page",
  "update_page",
  "delete_page",
  "create_menu",
  "update_site_settings",
  "run_wp_cli",
  "capture_screenshot",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolPermission = "read" | "write" | "destructive";

export const TOOL_PERMISSIONS: Record<ToolName, ToolPermission> = {
  get_project_state: "read",
  create_project: "write",
  start_wordpress: "write",
  stop_wordpress: "write",
  restart_wordpress: "write",
  install_theme: "write",
  activate_theme: "write",
  install_plugin: "write",
  activate_plugin: "write",
  configure_theme: "write",
  configure_plugin: "write",
  create_page: "write",
  update_page: "write",
  delete_page: "destructive",
  create_menu: "write",
  update_site_settings: "write",
  run_wp_cli: "destructive",
  capture_screenshot: "read",
};

// ---------------------------------------------------------------------------
// SEC-05: structured audit log for every tool call the dispatcher executes,
// regardless of whether it was triggered by the build pipeline, a chat edit,
// or a plugin install. Args are pre-redacted by the dispatcher before they
// ever reach this shape (secrets never get this far).
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  projectId: string;
  timestamp: string;
  tool: ToolName;
  permission: ToolPermission;
  args: Record<string, unknown>;
  ok: boolean;
  error: string | null;
  durationMs: number;
  source: "pipeline" | "chat" | "plugin" | "manual";
}

// ---------------------------------------------------------------------------
// VER-02/03/04: checkpoints (DB snapshot + spec snapshot) and standalone
// backups (DB + wp-content archive). Kept on the Project itself rather than
// a separate store collection so FND-06's storage swap doesn't need new
// store methods -- see apps/agent/src/db/store.ts.
// ---------------------------------------------------------------------------

export interface ProjectCheckpoint {
  id: string;
  projectId: string;
  createdAt: string;
  label: string;
  kind: "auto" | "manual";
  spec: SiteSpecification;
  dbDumpFile: string | null;
}

export interface ProjectBackup {
  id: string;
  projectId: string;
  createdAt: string;
  label: string;
  dbDumpFile: string;
  filesArchive: string | null;
}

// ---------------------------------------------------------------------------
// Project (aggregate root returned to the frontend)
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  status: ProjectState;
  createdAt: string;
  updatedAt: string;
  slots: RequirementSlots;
  spec: SiteSpecification;
  themeRecommendations: ThemeRecommendation[];
  docker: DockerEnvironment;
  log: LogEntry[];
  auditLog: AuditLogEntry[];
  checkpoints: ProjectCheckpoint[];
  backups: ProjectBackup[];
}

export interface LogEntry {
  id: string;
  projectId: string;
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error";
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectState;
  theme: string | null;
  updatedAt: string;
  wpPort: number | null;
}
