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
  // GEN-10: full design system, not just a single accent color. `preset`
  // names which curated font-pairing/radius bundle (engine/designSystem.ts)
  // this came from; heuristic keyword match by default, upgraded to an
  // AI-informed pick (secondary color included) when a provider is
  // configured -- see requirements.ts/routes/messages.ts.
  design: {
    style: string; // e.g. "minimal", "futuristic", "corporate"
    mode: "light" | "dark";
    primary_color: string;
    secondary_color: string;
    heading_font: string;
    body_font: string;
    radius: "sharp" | "soft" | "pill";
    preset: string; // e.g. "minimal", "bold", "playful", "corporate", "editorial"
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
  // Plugin "skills" resolved live against the public WordPress.org plugin
  // directory when a chat message names a capability that isn't in the
  // curated FEATURE_PLUGIN_MAP (apps/agent/src/tools/plugins.ts) -- see
  // apps/agent/src/engine/skills.ts. Separate from `features` because these
  // aren't part of the fixed, offline keyword vocabulary.
  discoveredSkills: DiscoveredSkillRef[];
}

export interface DiscoveredSkillRef {
  slug: string;
  name: string;
  query: string; // the phrase from the user's message that triggered the lookup
  source: "wordpress.org";
}

export function emptySiteSpecification(name = "Untitled Project"): SiteSpecification {
  return {
    site: { name, type: "", industry: "", audience: [] },
    pages: [],
    features: [],
    design: {
      style: "",
      mode: "light",
      primary_color: "#3651D4",
      secondary_color: "#1E8E5A",
      heading_font: "Inter",
      body_font: "Inter",
      radius: "soft",
      preset: "minimal",
    },
    theme: { selected: null, use_child_theme: true },
    ecommerce: { payment: null },
    seo: false,
    accessibility: false,
    integrations: [],
    discoveredSkills: [],
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
  // Accumulates opportunistically, same as colorPreference/ecommercePayment --
  // never gated behind a NEXT_QUESTIONS prompt, so it's never "still
  // unanswered" the way a null slot is; starts and can stay empty forever.
  discoveredSkills: DiscoveredSkillRef[] | null;
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
  discoveredSkills: null,
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
  screenshotUrl?: string; // small preview image shown next to the option (THM-04/THM-05)
}

export interface ThemeRecommendation {
  theme: ThemeDefinition;
  score: number; // 0-100
  reasons: string[];
  source?: "catalog" | "wordpress.org"; // THM-04
  variants?: ThemeVariant[]; // THM-05
}

// THM-05: named design-system tweaks a user can preview and pick before the
// build kicks off, without standing up N separate WordPress instances. GEN-10
// widened this from a single color+font swap to a full design-system bundle
// (see engine/designSystem.ts's DESIGN_PRESETS) so picking a variant is
// actually picking a distinct look, not just a different accent color.
export interface ThemeVariant {
  id: string;
  label: string;
  primary_color: string;
  secondary_color: string;
  mode: "light" | "dark";
  heading_font: string;
  body_font: string;
  radius: "sharp" | "soft" | "pill";
  preset: string;
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
  // SECURITY FIX (task 08, folding in a P0 finding from task 04's dispatcher
  // review): these three used to bypass the dispatcher entirely -- routes/
  // projects.ts called store.ts/tools/checkpoint.ts directly, with no
  // permission-tier gate and no audit-log entry, despite restoreCheckpoint/
  // restoreBackup running a real `wp db import` against the live site and
  // delete_project being irreversible. See apps/agent/src/tools/dispatcher.ts.
  "delete_project",
  "restore_checkpoint",
  "restore_backup",
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
  delete_project: "destructive",
  restore_checkpoint: "destructive",
  restore_backup: "destructive",
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

// ---------------------------------------------------------------------------
// CMS-01: manual + AI-assisted page content editing (post-build). Backed by
// the site's real WordPress pages -- these are read live from WP-CLI, not a
// separate content store, so the editor and the live site can never drift.
// ---------------------------------------------------------------------------

export interface CmsPageSummary {
  id: number;
  title: string;
  slug: string;
  status: string;
}

export interface CmsPageDetail extends CmsPageSummary {
  content: string; // raw Gutenberg block HTML, the same shape `post_content` already uses
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectState;
  theme: string | null;
  updatedAt: string;
  wpPort: number | null;
}
