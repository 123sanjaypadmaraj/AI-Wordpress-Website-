"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AuditLogEntry, CmsPageSummary, Project, ProjectBackup, ProjectCheckpoint } from "@ai-wp/shared";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

type Tab = "requirements" | "themes" | "progress" | "preview" | "content" | "history" | "settings";

// "STOPPED" rides alongside "READY" in every step below, not just the last
// one: apps/agent/src/routes/projects.ts's environment/stop route only ever
// moves a project to STOPPED from a completed build (Settings tab's "Stop
// environment" button only appears once docker.status is "running", i.e.
// post-build), and environment/start puts it straight back to READY. Without
// this, stopping a finished site's environment made this checklist regress
// to "nothing done yet", which reads as the build having been wiped rather
// than just paused. If a future change ever lets a project stop mid-build,
// this assumption -- and the route it depends on -- needs revisiting together.
const PIPELINE_STEPS: Array<{ label: string; states: string[] }> = [
  { label: "Requirements analyzed", states: ["SPECIFICATION_READY", "THEME_SELECTION", "ENVIRONMENT_CREATING", "WORDPRESS_READY", "THEME_INSTALLING", "PLUGINS_INSTALLING", "GENERATING", "CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY", "STOPPED"] },
  { label: "Theme selected", states: ["ENVIRONMENT_CREATING", "WORDPRESS_READY", "THEME_INSTALLING", "PLUGINS_INSTALLING", "GENERATING", "CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY", "STOPPED"] },
  { label: "WordPress created", states: ["WORDPRESS_READY", "THEME_INSTALLING", "PLUGINS_INSTALLING", "GENERATING", "CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY", "STOPPED"] },
  { label: "Theme + plugins installed", states: ["PLUGINS_INSTALLING", "GENERATING", "CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY", "STOPPED"] },
  { label: "Pages generated", states: ["CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY", "STOPPED"] },
  { label: "Navigation configured", states: ["TESTING", "VISUAL_REVIEW", "READY", "STOPPED"] },
  { label: "Tests run", states: ["VISUAL_REVIEW", "READY", "STOPPED"] },
  { label: "Visual review complete", states: ["READY", "STOPPED"] },
  { label: "Ready", states: ["READY", "STOPPED"] },
];

const KNOWN_PAGES = [
  "home", "about", "contact", "pricing", "team", "gallery", "blog", "faq", "testimonials", "careers",
  "shop", "product", "cart", "checkout", "projects", "menu", "reservations", "donate", "programs",
  "events", "members", "services", "case-studies",
];
const KNOWN_FEATURES = ["event-registration", "project-showcase", "contact-form", "ecommerce", "blog", "team-page", "newsletter", "booking"];
const STYLE_OPTIONS = ["minimal", "futuristic", "corporate", "playful", "premium", "bold"];
const FONT_OPTIONS = ["Inter", "IBM Plex Sans", "Georgia", "Poppins", "Nunito", "Playfair Display"];
const RADIUS_OPTIONS: Array<{ value: "sharp" | "soft" | "pill"; label: string }> = [
  { value: "sharp", label: "Sharp" },
  { value: "soft", label: "Soft" },
  { value: "pill", label: "Pill" },
];

export function BuilderSidePanel({
  project,
  onProjectUpdate,
}: {
  project: Project;
  onProjectUpdate: (p: Project) => void;
}) {
  const [tab, setTab] = useState<Tab>(
    project.status === "THEME_SELECTION" ? "themes" : project.status === "REQUIREMENTS" ? "requirements" : "progress",
  );
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [selecting, setSelecting] = useState<string | null>(null);
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const [reloadNonce, setReloadNonce] = useState(0);
  // Which generated page the preview iframe is showing -- "" means the
  // homepage (the static front page at the site root). Lets the Preview tab
  // actually browse the pages built from the requirements, not just the
  // homepage every generated site was previously stuck on.
  const [previewSlug, setPreviewSlug] = useState("");
  const wasReady = useRef(project.status === "READY");
  const wasThemeSelection = useRef(project.status === "THEME_SELECTION");

  // Jump straight to the live preview the moment a build finishes, instead
  // of leaving the visitor stranded on the Progress tab looking at a
  // finished checklist -- this is the "show me something interactive, not
  // just a log" complaint the Preview tab (below) is meant to fix.
  useEffect(() => {
    if (project.status === "READY" && !wasReady.current) {
      wasReady.current = true;
      setTab("preview");
    } else if (project.status !== "READY") {
      wasReady.current = false;
    }
  }, [project.status, wasReady]);

  // Same idea one step earlier: the requirements conversation finishing
  // flips status to THEME_SELECTION while this panel is already mounted (the
  // initial useState above only picks the tab once, at mount), so without
  // this the user is left looking at the now-stale Requirements tab with no
  // sign that theme recommendations are ready on the Themes tab.
  useEffect(() => {
    if (project.status === "THEME_SELECTION" && !wasThemeSelection.current) {
      wasThemeSelection.current = true;
      setTab("themes");
    } else if (project.status !== "THEME_SELECTION") {
      wasThemeSelection.current = false;
    }
  }, [project.status, wasThemeSelection]);

  async function selectTheme(slug: string) {
    setSelecting(slug);
    try {
      const updated = await api.selectTheme(project.id, slug, variantChoice[slug]);
      onProjectUpdate(updated);
      setTab("progress");
    } finally {
      setSelecting(null);
    }
  }

  // "What got built" summary -- surfaced once so a build's outcome is
  // legible at a glance instead of only living as scattered log lines.
  // Derived entirely from data the project already carries: no new backend
  // field is needed for the theme name (matched against the recommendations
  // this project was shown) or the plugin list (parsed off the pipeline's
  // own "Installed and configured plugin: X" log lines).
  const buildSummary = useMemo(() => {
    const slug = project.spec.theme.selected;
    const themeName =
      project.themeRecommendations.find((r) => r.theme.slug === slug)?.theme.name ?? slug ?? "—";
    const plugins = Array.from(
      new Set(
        project.log
          .map((l) => l.message.match(/^Installed and configured plugin: (.+)$/)?.[1])
          .filter((v): v is string => Boolean(v)),
      ),
    );
    return { themeName, plugins };
  }, [project.spec.theme.selected, project.themeRecommendations, project.log]);

  // Pages use pretty permalinks (/%postname%/, see tools/wordpress.ts) --
  // "home" is the exception, mapped to the static front page at the root.
  const previewUrl =
    previewSlug && project.docker.previewUrl
      ? `${project.docker.previewUrl.replace(/\/$/, "")}/${previewSlug}/`
      : (project.docker.previewUrl ?? undefined);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "requirements", label: "Requirements" },
    { id: "themes", label: "Themes" },
    { id: "progress", label: "Progress" },
    { id: "preview", label: "Preview" },
    { id: "content", label: "Content" },
    { id: "history", label: "History" },
    { id: "settings", label: "Settings" },
  ];

  const deviceWidths: Record<typeof device, string> = {
    desktop: "100%",
    tablet: "768px",
    mobile: "390px",
  } as const;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-surface">
      <div role="tablist" aria-label="Project sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 text-sm">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 ${tab === t.id ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-alt"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "requirements" && <RequirementsTab project={project} onProjectUpdate={onProjectUpdate} />}

        {tab === "themes" && (
          <div className="space-y-3">
            {project.themeRecommendations.length === 0 && (
              <p className="text-sm text-ink-muted">Finish the requirements conversation to see theme recommendations.</p>
            )}
            {project.themeRecommendations.map((r) => (
              <div key={r.theme.slug} className="rounded-lg border border-border p-3">
                <div className="flex gap-3">
                  <ThemeThumbnail url={r.theme.screenshotUrl} name={r.theme.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">
                        {r.theme.name}
                        {r.source === "wordpress.org" && (
                          <span className="ml-1.5 rounded-full bg-surface-alt px-1.5 py-0.5 text-[10px] font-normal text-ink-muted" title="Live WordPress.org search result (THM-04)">
                            wp.org
                          </span>
                        )}
                      </h3>
                      <span className="font-mono text-xs text-accent">{r.score}%</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{r.theme.description}</p>
                    <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                      {r.reasons.map((reason) => (
                        <li key={reason}>· {reason}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {r.variants && r.variants.length > 0 && (
                  <div className="mt-3">
                    <span className="text-[10px] uppercase tracking-wide text-ink-muted">Design variant (THM-05)</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {r.variants.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => setVariantChoice((c) => ({ ...c, [r.theme.slug]: c[r.theme.slug] === v.id ? "" : v.id }))}
                          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                            variantChoice[r.theme.slug] === v.id ? "border-accent bg-accent-soft text-accent" : "border-border text-ink-muted"
                          }`}
                        >
                          <span
                            className="h-3 w-3 rounded-full border border-border"
                            style={{ background: `linear-gradient(90deg, ${v.primary_color} 50%, ${v.secondary_color} 50%)` }}
                            title={`${v.primary_color} / ${v.secondary_color}`}
                          />
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => selectTheme(r.theme.slug)}
                  disabled={selecting !== null || project.spec.theme.selected === r.theme.slug}
                  className="mt-3 w-full rounded-md bg-accent py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {project.spec.theme.selected === r.theme.slug
                    ? "Selected"
                    : selecting === r.theme.slug
                      ? "Starting build…"
                      : "Select this theme"}
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === "progress" && (
          <div className="space-y-4">
            {project.status === "ERROR" && (
              <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                The build failed. See the log below for details -- the Chat tab or History tab's checkpoints
                can help you retry or undo whatever change triggered it.
              </div>
            )}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Build pipeline</span>
                <StatusBadge status={project.status} />
              </div>
              <ul className="space-y-1.5 text-sm">
                {PIPELINE_STEPS.map((step) => {
                  const done = step.states.includes(project.status);
                  const active =
                    !done &&
                    PIPELINE_STEPS[PIPELINE_STEPS.indexOf(step) - 1]?.states.includes(project.status);
                  return (
                    <li key={step.label} className="flex items-center gap-2">
                      <span className={done ? "text-emerald-400" : active ? "text-amber-400" : "text-ink-muted"}>
                        {done ? "✓" : active ? "●" : "○"}
                      </span>
                      <span className={done ? "" : "text-ink-muted"}>{step.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wide text-ink-muted">Log</span>
              <div className="mt-1 max-h-64 space-y-1 overflow-y-auto rounded-lg bg-surface-alt p-2 font-mono text-xs">
                {project.log.length === 0 && <p className="text-ink-muted">No activity yet.</p>}
                {project.log.map((entry) => (
                  <p
                    key={entry.id}
                    className={entry.level === "error" ? "text-rose-400" : entry.level === "warn" ? "text-amber-400" : "text-ink-muted"}
                  >
                    {new Date(entry.timestamp).toLocaleTimeString()} {entry.message}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "preview" && (
          <div className="flex h-full flex-col gap-3">
            {!project.docker.previewUrl ? (
              <p className="text-sm text-ink-muted">No live preview yet -- select a theme to start the build.</p>
            ) : (
              <>
                {project.status === "READY" && (
                  <div className="rounded-lg border border-border bg-surface-alt p-3 text-xs">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium text-ink">What we built</span>
                      <div className="flex gap-1">
                        <span
                          className="h-3 w-3 rounded-full border border-border"
                          style={{ backgroundColor: project.spec.design.primary_color }}
                          title={`Primary color ${project.spec.design.primary_color}`}
                        />
                        <span
                          className="h-3 w-3 rounded-full border border-border"
                          style={{ backgroundColor: project.spec.design.secondary_color }}
                          title={`Secondary color ${project.spec.design.secondary_color}`}
                        />
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      <dt className="text-ink-muted">Theme</dt>
                      <dd>{buildSummary.themeName}</dd>
                      <dt className="text-ink-muted">Style</dt>
                      <dd className="capitalize">{project.spec.design.style || "—"}</dd>
                      <dt className="text-ink-muted">Pages</dt>
                      <dd>{project.spec.pages.length}</dd>
                      <dt className="text-ink-muted">Features</dt>
                      <dd>{project.spec.features.length ? project.spec.features.join(", ") : "None"}</dd>
                      <dt className="text-ink-muted">Plugins</dt>
                      <dd>{buildSummary.plugins.length ? buildSummary.plugins.join(", ") : "None"}</dd>
                    </dl>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {project.spec.pages.map((slug) => (
                        <button
                          key={slug}
                          onClick={() => setPreviewSlug(slug === "home" ? "" : slug)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${
                            (previewSlug || "home") === slug
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-border text-ink-muted hover:text-accent"
                          }`}
                        >
                          {slug}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-1.5 text-xs">
                  {(["desktop", "tablet", "mobile"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDevice(d)}
                      className={`rounded-md px-2.5 py-1 ${device === d ? "bg-accent-soft text-accent" : "border border-border text-ink-muted"}`}
                    >
                      {d[0].toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                  <button
                    onClick={() => setReloadNonce((n) => n + 1)}
                    className="rounded-md border border-border px-2.5 py-1 text-ink-muted hover:text-accent"
                    title="Reload preview"
                  >
                    ↻ Reload
                  </button>
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-border px-2.5 py-1 text-ink-muted hover:text-accent"
                  >
                    Open in new tab ↗
                  </a>
                </div>
                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-surface-alt p-2">
                  <iframe
                    key={`${project.updatedAt}-${reloadNonce}-${previewSlug}`}
                    src={previewUrl}
                    style={{ width: deviceWidths[device], height: "560px", maxWidth: "100%" }}
                    className="mx-auto rounded-md border border-border bg-white"
                    title="Live preview"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {tab === "content" && <ContentTab project={project} />}

        {tab === "history" && <HistoryTab project={project} onProjectUpdate={onProjectUpdate} />}

        {tab === "settings" && <SettingsTab project={project} onProjectUpdate={onProjectUpdate} />}
      </div>
    </div>
  );
}

// Small preview image shown right next to each theme option so it can be
// judged at a glance while selecting. Falls back to an initial-letter tile
// when a theme has no screenshot or the image fails to load.
function ThemeThumbnail({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div className="flex h-16 w-20 flex-shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt text-sm font-medium text-ink-muted">
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={`${name} preview`}
      className="h-16 w-20 flex-shrink-0 rounded-md border border-border object-cover"
      onError={() => setFailed(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// REQ-06: inline requirements editing.
// ---------------------------------------------------------------------------

function RequirementsTab({ project, onProjectUpdate }: { project: Project; onProjectUpdate: (p: Project) => void }) {
  const [type, setType] = useState(project.spec.site.type);
  const [audience, setAudience] = useState(project.spec.site.audience.join(", "));
  const [pages, setPages] = useState<string[]>(project.spec.pages);
  const [features, setFeatures] = useState<string[]>(project.spec.features);
  const [style, setStyle] = useState(project.spec.design.style);
  const [color, setColor] = useState(project.spec.design.primary_color);
  const [secondaryColor, setSecondaryColor] = useState(project.spec.design.secondary_color);
  const [headingFont, setHeadingFont] = useState(project.spec.design.heading_font);
  const [bodyFont, setBodyFont] = useState(project.spec.design.body_font);
  const [radius, setRadius] = useState(project.spec.design.radius);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const dirty =
    type !== project.spec.site.type ||
    audience !== project.spec.site.audience.join(", ") ||
    JSON.stringify(pages) !== JSON.stringify(project.spec.pages) ||
    JSON.stringify(features) !== JSON.stringify(project.spec.features) ||
    style !== project.spec.design.style ||
    color !== project.spec.design.primary_color ||
    secondaryColor !== project.spec.design.secondary_color ||
    headingFont !== project.spec.design.heading_font ||
    bodyFont !== project.spec.design.body_font ||
    radius !== project.spec.design.radius;

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      const patch = {
        site: { ...project.spec.site, type, audience: audience.split(",").map((a) => a.trim()).filter(Boolean) },
        pages,
        features,
        design: {
          ...project.spec.design,
          style,
          primary_color: color,
          secondary_color: secondaryColor,
          heading_font: headingFont,
          body_font: bodyFont,
          radius,
        },
      };
      const res = await api.updateSpec(project.id, patch);
      if ("project" in res) {
        onProjectUpdate(res.project);
        setResult(res.applied.length ? res.applied.join(" ") : "No changes needed.");
      } else {
        onProjectUpdate(res);
        setResult("Saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <LabeledField label="Website type" htmlFor="req-type">
        <input id="req-type" value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-sm" />
      </LabeledField>
      <LabeledField label="Audience (comma-separated)" htmlFor="req-audience">
        <input id="req-audience" value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-sm" />
      </LabeledField>
      <LabeledField label="Pages">
        <div className="flex flex-wrap gap-1.5">
          {Array.from(new Set([...KNOWN_PAGES, ...pages])).map((p) => (
            <Chip key={p} active={pages.includes(p)} onClick={() => toggle(pages, setPages, p)} label={p} />
          ))}
        </div>
      </LabeledField>
      <LabeledField label="Features">
        <div className="flex flex-wrap gap-1.5">
          {Array.from(new Set([...KNOWN_FEATURES, ...features])).map((f) => (
            <Chip key={f} active={features.includes(f)} onClick={() => toggle(features, setFeatures, f)} label={f} />
          ))}
        </div>
      </LabeledField>
      <LabeledField label="Visual style" htmlFor="req-style">
        <select id="req-style" value={style} onChange={(e) => setStyle(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-sm">
          {Array.from(new Set([style, ...STYLE_OPTIONS])).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </LabeledField>
      <div className="flex flex-wrap items-end gap-4">
        <LabeledField label="Primary color" htmlFor="req-primary-color">
          <input id="req-primary-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-14 rounded border border-border bg-canvas" />
        </LabeledField>
        <LabeledField label="Secondary color" htmlFor="req-secondary-color">
          <input
            id="req-secondary-color"
            type="color"
            value={secondaryColor}
            onChange={(e) => setSecondaryColor(e.target.value)}
            className="h-8 w-14 rounded border border-border bg-canvas"
          />
        </LabeledField>
        <LabeledField label="Corner style" htmlFor="req-radius">
          <select
            id="req-radius"
            value={radius}
            onChange={(e) => setRadius(e.target.value as typeof radius)}
            className="rounded-md border border-border bg-canvas px-2 py-1 text-sm"
          >
            {RADIUS_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </LabeledField>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <LabeledField label="Heading font" htmlFor="req-heading-font">
          <select id="req-heading-font" value={headingFont} onChange={(e) => setHeadingFont(e.target.value)} className="rounded-md border border-border bg-canvas px-2 py-1 text-sm">
            {Array.from(new Set([headingFont, ...FONT_OPTIONS])).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </LabeledField>
        <LabeledField label="Body font" htmlFor="req-body-font">
          <select id="req-body-font" value={bodyFont} onChange={(e) => setBodyFont(e.target.value)} className="rounded-md border border-border bg-canvas px-2 py-1 text-sm">
            {Array.from(new Set([bodyFont, ...FONT_OPTIONS])).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </LabeledField>
      </div>

      <button
        onClick={save}
        disabled={!dirty || saving}
        className="w-full rounded-md bg-accent py-1.5 text-xs font-medium text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
      {result && <p className="text-xs text-ink-muted">{result}</p>}
      {project.status === "READY" && (
        <p className="text-xs text-ink-muted">
          The site is already built -- saving here applies targeted changes to the live site (GEN-09), the same way chat edits do.
        </p>
      )}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs ${active ? "border-accent bg-accent-soft text-accent" : "border-border text-ink-muted"}`}
    >
      {label}
    </button>
  );
}

// `htmlFor` associates the label with a single real form control (input/
// select) via a proper <label>, so screen readers get an accessible name --
// the visible heading text alone (a plain <div>) isn't programmatically
// linked to anything. Omit it for a group of several controls (e.g. the
// Pages/Features chip lists below): those get `role="group"` +
// `aria-label` instead, since wrapping multiple buttons in one <label>
// would make clicking the heading text activate just the first one.
function LabeledField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  if (htmlFor) {
    return (
      <div>
        <label htmlFor={htmlFor} className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
          {label}
        </label>
        {children}
      </div>
    );
  }
  return (
    <div role="group" aria-label={label}>
      <div className="mb-1 text-xs uppercase tracking-wide text-ink-muted" aria-hidden="true">
        {label}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CMS-01: manual + AI-assisted page content editing, read/written live
// against the project's real WordPress (apps/agent/src/routes/content.ts) --
// not a separate content store, so this can never drift from the live site.
// A manual save and an AI-drafted save both go through the same PUT, which
// auto-checkpoints first (VER-02), so either kind of edit is one "Restore"
// away from undone from the History tab.
// ---------------------------------------------------------------------------

function ContentTab({ project }: { project: Project }) {
  const [pages, setPages] = useState<CmsPageSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState<{ title: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [instruction, setInstruction] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const running = project.docker.status === "running";

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    api
      .listPages(project.id)
      .then((p) => {
        if (!cancelled) {
          setPages(p);
          setListError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setListError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, running]);

  async function selectPage(id: number) {
    setSelectedId(id);
    setLoadingPage(true);
    setSaveResult(null);
    setSaveError(null);
    setDraftError(null);
    try {
      const page = await api.getPage(project.id, id);
      setTitle(page.title);
      setContent(page.content);
      setLoaded({ title: page.title, content: page.content });
    } finally {
      setLoadingPage(false);
    }
  }

  const dirty = loaded !== null && (title !== loaded.title || content !== loaded.content);

  async function save() {
    if (selectedId === null) return;
    setSaving(true);
    setSaveResult(null);
    setSaveError(null);
    try {
      const updated = await api.savePage(project.id, selectedId, { title, content });
      setTitle(updated.title);
      setContent(updated.content);
      setLoaded({ title: updated.title, content: updated.content });
      setPages((ps) => ps?.map((p) => (p.id === updated.id ? { ...p, title: updated.title } : p)) ?? ps);
      setSaveResult("Saved to the live site.");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function askAi() {
    if (selectedId === null || !instruction.trim() || drafting) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const draft = await api.aiDraftPage(project.id, selectedId, instruction.trim());
      setTitle(draft.title);
      setContent(draft.content);
      setInstruction("");
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  if (!running) {
    return <p className="text-sm text-ink-muted">Start the environment (Settings tab) to edit page content.</p>;
  }

  const editUrl =
    project.docker.adminUrl && selectedId !== null ? `${project.docker.adminUrl}/post.php?post=${selectedId}&action=edit` : null;

  return (
    <div className="flex h-full min-h-0 gap-3 text-sm">
      <div className="w-36 shrink-0 space-y-1 overflow-y-auto border-r border-border pr-2">
        <div className="mb-1 text-xs uppercase tracking-wide text-ink-muted">Pages</div>
        {listError && <p className="text-xs text-rose-400">{listError}</p>}
        {pages === null && !listError && <p className="text-xs text-ink-muted">Loading…</p>}
        {pages?.length === 0 && <p className="text-xs text-ink-muted">No pages yet.</p>}
        {pages?.map((p) => (
          <button
            key={p.id}
            onClick={() => selectPage(p.id)}
            title={p.title}
            className={`block w-full truncate rounded-md px-2 py-1 text-left text-xs ${
              selectedId === p.id ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-alt"
            }`}
          >
            {p.title}
            {p.status !== "publish" && <span className="ml-1 text-[10px] opacity-70">({p.status})</span>}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pl-1">
        {selectedId === null && <p className="text-sm text-ink-muted">Pick a page on the left to edit its title and content.</p>}
        {selectedId !== null && loadingPage && <p className="text-sm text-ink-muted">Loading page…</p>}
        {selectedId !== null && !loadingPage && (
          <div className="space-y-3">
            <LabeledField label="Title" htmlFor="content-title">
              <input
                id="content-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-sm"
              />
            </LabeledField>

            <LabeledField label="Content (Gutenberg block HTML)" htmlFor="content-body">
              <textarea
                id="content-body"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full rounded-md border border-border bg-canvas px-2 py-1.5 font-mono text-xs leading-relaxed"
              />
            </LabeledField>

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              {editUrl && (
                <a href={editUrl} target="_blank" rel="noreferrer" className="text-xs text-ink-muted hover:text-accent">
                  Open in WordPress editor ↗
                </a>
              )}
            </div>
            {saveResult && <p className="text-xs text-emerald-400">{saveResult}</p>}
            {saveError && <p className="text-xs text-rose-400">{saveError}</p>}

            <div className="border-t border-border pt-3">
              <label htmlFor="content-ai-instruction" className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
                Ask AI to edit this page
              </label>
              <div className="flex gap-2">
                <input
                  id="content-ai-instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && askAi()}
                  placeholder='e.g. "make the intro shorter" or "add a paragraph about our warranty"'
                  className="flex-1 rounded-md border border-border bg-canvas px-2 py-1 text-sm"
                />
                <button
                  onClick={askAi}
                  disabled={drafting || !instruction.trim()}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  {drafting ? "Thinking…" : "Generate"}
                </button>
              </div>
              {draftError && <p className="mt-1.5 text-xs text-rose-400">{draftError}</p>}
              <p className="mt-1.5 text-xs text-ink-muted">
                Fills in a suggested rewrite above for you to review -- nothing is written to the live site until you
                click Save changes.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VER-02/03/04, SEC-05: checkpoints, backups, audit log.
// ---------------------------------------------------------------------------

function HistoryTab({ project, onProjectUpdate }: { project: Project; onProjectUpdate: (p: Project) => void }) {
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>(project.checkpoints ?? []);
  const [backups, setBackups] = useState<ProjectBackup[]>(project.backups ?? []);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.listCheckpoints(project.id).then(setCheckpoints).catch(() => undefined);
    api.listBackups(project.id).then(setBackups).catch(() => undefined);
  }, [project.id]);

  async function restore(checkpointId: string) {
    if (!confirm("Restore this checkpoint? This overwrites the current database state.")) return;
    setBusy(checkpointId);
    try {
      onProjectUpdate(await api.restoreCheckpoint(project.id, checkpointId));
    } finally {
      setBusy(null);
    }
  }

  async function manualCheckpoint() {
    setBusy("manual");
    try {
      const cp = await api.createCheckpoint(project.id, "manual checkpoint");
      setCheckpoints((c) => [...c, cp]);
    } finally {
      setBusy(null);
    }
  }

  async function backupNow() {
    setBusy("backup");
    try {
      const b = await api.createBackup(project.id, "manual backup");
      setBackups((b2) => [...b2, b]);
    } finally {
      setBusy(null);
    }
  }

  async function restoreBackup(backupId: string) {
    if (!confirm("Restore this backup? This overwrites the current database and files.")) return;
    setBusy(backupId);
    try {
      onProjectUpdate(await api.restoreBackup(project.id, backupId));
    } finally {
      setBusy(null);
    }
  }

  async function loadAudit() {
    setShowAudit((v) => !v);
    if (auditLog.length === 0) setAuditLog(await api.getAuditLog(project.id));
  }

  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Checkpoints (VER-02/03)</span>
          <button onClick={manualCheckpoint} disabled={busy !== null} className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-40">
            {busy === "manual" ? "Saving…" : "+ Checkpoint now"}
          </button>
        </div>
        {checkpoints.length === 0 && <p className="text-xs text-ink-muted">No checkpoints yet -- one is taken automatically after the first build and before every chat-driven edit.</p>}
        <ul className="space-y-1.5">
          {[...checkpoints].reverse().map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
              <div>
                <div className="text-xs">{c.label} <span className="text-ink-muted">({c.kind})</span></div>
                <div className="font-mono text-[10px] text-ink-muted">{new Date(c.createdAt).toLocaleString()}</div>
              </div>
              <button onClick={() => restore(c.id)} disabled={busy !== null || !c.dbDumpFile} className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-40">
                {busy === c.id ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Backups (VER-04)</span>
          <button onClick={backupNow} disabled={busy !== null || project.docker.status !== "running"} className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-40">
            {busy === "backup" ? "Backing up…" : "+ Backup now"}
          </button>
        </div>
        {backups.length === 0 && <p className="text-xs text-ink-muted">No backups yet. A backup includes the full database and wp-content.</p>}
        <ul className="space-y-1.5">
          {[...backups].reverse().map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
              <div>
                <div className="text-xs">{b.label}</div>
                <div className="font-mono text-[10px] text-ink-muted">{new Date(b.createdAt).toLocaleString()}</div>
              </div>
              <button onClick={() => restoreBackup(b.id)} disabled={busy !== null} className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-40">
                {busy === b.id ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <button onClick={loadAudit} className="text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-accent">
          {showAudit ? "Hide" : "Show"} audit log (SEC-05) →
        </button>
        {showAudit && (
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg bg-surface-alt p-2 font-mono text-[11px]">
            {auditLog.length === 0 && <p className="text-ink-muted">No tool calls recorded yet.</p>}
            {[...auditLog].reverse().map((a) => (
              <p key={a.id} className={a.ok ? "text-ink-muted" : "text-rose-400"}>
                {new Date(a.timestamp).toLocaleTimeString()} [{a.source}] {a.tool} ({a.permission}) {a.ok ? "ok" : `failed: ${a.error}`} · {a.durationMs}ms
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DOCK-05, EXP-01/02: environment controls + export.
// ---------------------------------------------------------------------------

function SettingsTab({ project, onProjectUpdate }: { project: Project; onProjectUpdate: (p: Project) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState<{ relativePath: string; bytes: number } | null>(null);

  async function run(action: string, fn: () => Promise<Project>) {
    setBusy(action);
    try {
      onProjectUpdate(await fn());
    } finally {
      setBusy(null);
    }
  }

  async function doExport() {
    setBusy("export");
    try {
      setExportInfo(await api.exportProject(project.id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <Field label="Project ID" value={project.id} mono />
      <Field label="Environment status" value={project.docker.status} />
      <Field label="WordPress port" value={project.docker.wpPort ? String(project.docker.wpPort) : "—"} />
      <Field label="Admin URL" value={project.docker.adminUrl ?? "—"} />
      <Field label="Theme" value={project.spec.theme.selected ?? "—"} />

      <div className="flex flex-wrap gap-2">
        {project.docker.status === "running" && (
          <>
            <button
              onClick={() => {
                if (!confirm("Stop this project's WordPress environment?")) return;
                run("stop", () => api.stopEnvironment(project.id));
              }}
              disabled={busy !== null}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-ink-muted hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-40"
            >
              {busy === "stop" ? "Stopping…" : "Stop environment"}
            </button>
            <button
              onClick={() => run("restart", () => api.restartEnvironment(project.id))}
              disabled={busy !== null}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-ink-muted hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {busy === "restart" ? "Restarting…" : "Restart environment"}
            </button>
          </>
        )}
        {project.docker.status === "stopped" && (
          <button
            onClick={() => run("start", () => api.startEnvironment(project.id))}
            disabled={busy !== null}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy === "start" ? "Starting…" : "Start environment"}
          </button>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">Export (EXP-01/02)</div>
        <p className="mb-2 text-xs text-ink-muted">Packages page content, the generated child theme, and a reproducible Docker Compose bundle into one zip.</p>
        <button
          onClick={doExport}
          disabled={busy !== null || project.docker.status !== "running"}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {busy === "export" ? "Exporting…" : "Export project"}
        </button>
        {exportInfo && (
          <p className="mt-2 text-xs">
            <a
              href={api.exportDownloadUrl(project.id, exportInfo.relativePath)}
              className="text-accent hover:underline"
            >
              Download {exportInfo.relativePath}
            </a>{" "}
            ({Math.round(exportInfo.bytes / 1024)} KB)
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={mono ? "font-mono text-xs" : ""}>{value}</div>
    </div>
  );
}
