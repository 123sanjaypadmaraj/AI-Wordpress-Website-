"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProjectSummary } from "@ai-wp/shared";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the agent server.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await api.createProject(newName.trim());
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project.");
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this project? This tears down its Docker environment too.")) return;
    await api.deleteProject(id);
    refresh();
  }

  async function duplicate(id: string) {
    await api.duplicateProject(id);
    refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Every project is an isolated, AI-built WordPress site running in its own Docker environment.
          </p>
        </div>
      </div>

      <form onSubmit={createProject} className="flex gap-2 rounded-xl border border-border bg-surface p-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={'Name this project, e.g. "Robotics Club Site"'}
          className="flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40"
        >
          {creating ? "Creating…" : "+ New Project"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error} -- is the agent server running (<code className="font-mono">npm run dev:agent</code>)?
        </div>
      )}

      {projects === null && !error && <p className="text-sm text-ink-muted">Loading projects…</p>}

      {projects?.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-ink-muted">
          No projects yet. Create one above to start the conversation.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <div key={p.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Link href={`/projects/${p.id}`} className="font-medium hover:text-accent">
                  {p.name}
                </Link>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {p.theme ? `Theme: ${p.theme}` : "No theme selected yet"}
                </p>
              </div>
              <StatusBadge status={p.status} />
            </div>

            <p className="text-xs text-ink-muted">
              Updated {new Date(p.updatedAt).toLocaleString()}
              {p.wpPort ? ` · localhost:${p.wpPort}` : ""}
            </p>

            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              <Link href={`/projects/${p.id}`} className="rounded-md border border-border px-2.5 py-1 hover:border-accent hover:text-accent">
                Edit
              </Link>
              {p.wpPort && (
                <a
                  href={`http://localhost:${p.wpPort}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-border px-2.5 py-1 hover:border-accent hover:text-accent"
                >
                  Preview
                </a>
              )}
              <button onClick={() => duplicate(p.id)} className="rounded-md border border-border px-2.5 py-1 hover:border-accent hover:text-accent">
                Duplicate
              </button>
              <button onClick={() => remove(p.id)} className="rounded-md border border-border px-2.5 py-1 text-rose-600 hover:border-rose-300 hover:bg-rose-50">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
