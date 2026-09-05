"use client";

import { useEffect, useState } from "react";
import type { AuditLogEntry, Project, ProjectBackup, ProjectCheckpoint } from "@ai-wp/shared";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

type Tab = "requirements" | "themes" | "progress" | "preview" | "history" | "settings";

const PIPELINE_STEPS: Array<{ label: string; states: string[] }> = [
  { label: "Requirements analyzed", states: ["SPECIFICATION_READY", "THEME_SELECTION", "ENVIRONMENT_CREATING", "WORDPRESS_READY", "THEME_INSTALLING", "PLUGINS_INSTALLING", "GENERATING", "CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY"] },
  { label: "Theme selected", states: ["ENVIRONMENT_CREATING", "WORDPRESS_READY", "THEME_INSTALLING", "PLUGINS_INSTALLING", "GENERATING", "CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY"] },
  { label: "WordPress created", states: ["WORDPRESS_READY", "THEME_INSTALLING", "PLUGINS_INSTALLING", "GENERATING", "CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY"] },
  { label: "Theme + plugins installed", states: ["PLUGINS_INSTALLING", "GENERATING", "CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY"] },
  { label: "Pages generated", states: ["CONFIGURING", "TESTING", "VISUAL_REVIEW", "READY"] },
  { label: "Navigation configured", states: ["TESTING", "VISUAL_REVIEW", "READY"] },
  { label: "Tests run", states: ["VISUAL_REVIEW", "READY"] },
  { label: "Visual review complete", states: ["READY"] },
  { label: "Ready", states: ["READY"] },
];

const KNOWN_PAGES = ["home", "about", "contact", "pricing", "team", "gallery", "blog", "faq", "testimonials"];
const KNOWN_FEATURES = ["event-registration", "project-showcase", "contact-form", "ecommerce", "blog", "team-page", "newsletter", "booking"];
const STYLE_OPTIONS = ["minimal", "futuristic", "corporate", "playful", "premium", "bold"];
const FONT_OPTIONS = ["Inter", "IBM Plex Sans", "Georgia"];

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

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "requirements", label: "Requirements" },
    { id: "themes", label: "Themes" },
    { id: "progress", label: "Progress" },
    { id: "preview", label: "Preview" },
    { id: "history", label: "History" },
    { id: "settings", label: "Settings" },
  ];

  const deviceWidths: Record<typeof device, string> = {
    desktop: "100%",
    tablet: "768px",
    mobile: "390px",
  } as const;

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-surface">
      <div className="flex gap-1 overflow-x-auto border-b border-border p-2 text-sm">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 ${tab === t.id ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-alt"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "requirements" && <RequirementsTab project={project} onProjectUpdate={onProjectUpdate} />}

        {tab === "themes" && (
          <div className="space-y-3">
            {project.themeRecommendations.length === 0 && (
              <p className="text-sm text-ink-muted">Finish the requirements conversation to see theme recommendations.</p>
            )}
            {project.themeRecommendations.map((r) => (
              <div key={r.theme.slug} className="rounded-lg border border-border p-3">
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
                          <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: v.primary_color }} />
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
                      <span className={done ? "text-emerald-600" : active ? "text-amber-600" : "text-ink-muted"}>
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
                    className={entry.level === "error" ? "text-rose-600" : entry.level === "warn" ? "text-amber-600" : "text-ink-muted"}
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
                  <a
                    href={project.docker.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto rounded-md border border-border px-2.5 py-1 text-ink-muted hover:text-accent"
                  >
                    Open in new tab ↗
                  </a>
                </div>
                <div className="flex-1 overflow-auto rounded-lg border border-border bg-surface-alt p-2">
                  <iframe
                    src={project.docker.previewUrl}
                    style={{ width: deviceWidths[device], height: "560px", maxWidth: "100%" }}
                    className="mx-auto rounded-md border border-border bg-white"
                    title="Live preview"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {tab === "history" && <HistoryTab project={project} onProjectUpdate={onProjectUpdate} />}

        {tab === "settings" && <SettingsTab project={project} onProjectUpdate={onProjectUpdate} />}
      </div>
    </div>
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
  const [font, setFont] = useState(project.spec.design.font);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const dirty =
    type !== project.spec.site.type ||
    audience !== project.spec.site.audience.join(", ") ||
    JSON.stringify(pages) !== JSON.stringify(project.spec.pages) ||
    JSON.stringify(features) !== JSON.stringify(project.spec.features) ||
    style !== project.spec.design.style ||
    color !== project.spec.design.primary_color ||
    font !== project.spec.design.font;

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
        design: { ...project.spec.design, style, primary_color: color, font },
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
      <LabeledField label="Website type">
        <input value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-sm" />
      </LabeledField>
      <LabeledField label="Audience (comma-separated)">
        <input value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-sm" />
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
      <LabeledField label="Visual style">
        <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-sm">
          {Array.from(new Set([style, ...STYLE_OPTIONS])).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </LabeledField>
      <div className="flex items-end gap-4">
        <LabeledField label="Primary color">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-14 rounded border border-border bg-canvas" />
        </LabeledField>
        <LabeledField label="Font">
          <select value={font} onChange={(e) => setFont(e.target.value)} className="rounded-md border border-border bg-canvas px-2 py-1 text-sm">
            {Array.from(new Set([font, ...FONT_OPTIONS])).map((f) => (
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
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs ${active ? "border-accent bg-accent-soft text-accent" : "border-border text-ink-muted"}`}
    >
      {label}
    </button>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      {children}
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
              <p key={a.id} className={a.ok ? "text-ink-muted" : "text-rose-600"}>
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
              className="rounded-md border border-border px-3 py-1.5 text-xs text-ink-muted hover:border-rose-300 hover:text-rose-600 disabled:opacity-40"
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
