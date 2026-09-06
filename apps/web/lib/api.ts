import type {
  AuditLogEntry,
  ChatChoice,
  CmsPageDetail,
  CmsPageSummary,
  Message,
  Project,
  ProjectBackup,
  ProjectCheckpoint,
  ProjectSummary,
  SiteSpecification,
  ThemeRecommendation,
} from "@ai-wp/shared";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listProjects: () => request<ProjectSummary[]>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (name: string) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  duplicateProject: (id: string) => request<Project>(`/projects/${id}/duplicate`, { method: "POST" }),

  // DOCK-04/05
  stopEnvironment: (id: string) => request<Project>(`/projects/${id}/environment/stop`, { method: "POST" }),
  startEnvironment: (id: string) => request<Project>(`/projects/${id}/environment/start`, { method: "POST" }),
  restartEnvironment: (id: string) => request<Project>(`/projects/${id}/environment/restart`, { method: "POST" }),

  listMessages: (id: string) => request<Message[]>(`/projects/${id}/messages`),
  sendMessage: (id: string, text: string) =>
    request<{ project: Project; messages: Message[] }>(`/projects/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  getThemeRecommendations: (id: string) => request<ThemeRecommendation[]>(`/projects/${id}/themes`),
  selectTheme: (id: string, slug: string, variantId?: string) =>
    request<Project>(`/projects/${id}/themes/select`, { method: "POST", body: JSON.stringify({ slug, variantId }) }),

  // REQ-06
  updateSpec: (id: string, patch: Partial<SiteSpecification>) =>
    request<Project | { project: Project; applied: string[] }>(`/projects/${id}/spec`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // SEC-05
  getAuditLog: (id: string) => request<AuditLogEntry[]>(`/projects/${id}/audit-log`),

  // VER-02/03
  listCheckpoints: (id: string) => request<ProjectCheckpoint[]>(`/projects/${id}/checkpoints`),
  createCheckpoint: (id: string, label: string) =>
    request<ProjectCheckpoint>(`/projects/${id}/checkpoints`, { method: "POST", body: JSON.stringify({ label }) }),
  restoreCheckpoint: (id: string, checkpointId: string) =>
    request<Project>(`/projects/${id}/checkpoints/${checkpointId}/restore`, { method: "POST" }),

  // VER-04
  listBackups: (id: string) => request<ProjectBackup[]>(`/projects/${id}/backups`),
  createBackup: (id: string, label: string) =>
    request<ProjectBackup>(`/projects/${id}/backups`, { method: "POST", body: JSON.stringify({ label }) }),
  restoreBackup: (id: string, backupId: string) =>
    request<Project>(`/projects/${id}/backups/${backupId}/restore`, { method: "POST" }),

  // EXP-01/02
  exportProject: (id: string) =>
    request<{ relativePath: string; bytes: number }>(`/projects/${id}/export`, { method: "POST" }),
  exportDownloadUrl: (id: string, relativePath: string) => `${AGENT_URL}/projects/${id}/export/${relativePath}`,

  screenshotUrl: (id: string, relativePath: string) => `${AGENT_URL}/projects/${id}/screenshots/${relativePath}`,

  // CMS-01: content editor
  listPages: (id: string) => request<CmsPageSummary[]>(`/projects/${id}/pages`),
  getPage: (id: string, pageId: number) => request<CmsPageDetail>(`/projects/${id}/pages/${pageId}`),
  savePage: (id: string, pageId: number, patch: { title?: string; content?: string }) =>
    request<CmsPageDetail>(`/projects/${id}/pages/${pageId}`, { method: "PUT", body: JSON.stringify(patch) }),
  aiDraftPage: (id: string, pageId: number, instruction: string) =>
    request<{ title: string; content: string }>(`/projects/${id}/pages/${pageId}/ai-draft`, {
      method: "POST",
      body: JSON.stringify({ instruction }),
    }),

  agentUrl: AGENT_URL,
};

export type { ChatChoice };
