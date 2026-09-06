"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Project } from "@ai-wp/shared";
import { api } from "@/lib/api";
import { ChatPanel } from "@/components/ChatPanel";
import { BuilderSidePanel } from "@/components/BuilderSidePanel";
import { StatusBadge } from "@/components/StatusBadge";

const TRANSIENT_STATES = new Set([
  "ENVIRONMENT_CREATING", "WORDPRESS_READY", "THEME_INSTALLING",
  "PLUGINS_INSTALLING", "GENERATING", "CONFIGURING", "TESTING", "VISUAL_REVIEW",
]);

export default function ProjectBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const p = await api.getProject(id);
        if (!cancelled) setProject(p);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    }
    load();
    const interval = setInterval(() => {
      if (project && TRANSIENT_STATES.has(project.status)) load();
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, project?.status]);

  if (notFound) {
    return (
      <div className="text-sm text-ink-muted">
        Project not found. <Link href="/" className="text-accent">Back to dashboard</Link>.
      </div>
    );
  }

  if (!project) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/")} className="text-sm text-ink-muted hover:text-ink">
            ← Dashboard
          </button>
          <h1 className="text-lg font-semibold">{project.name}</h1>
          <StatusBadge status={project.status} />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2">
        <ChatPanel project={project} onProjectUpdate={setProject} />
        <BuilderSidePanel project={project} onProjectUpdate={setProject} />
      </div>
    </div>
  );
}
