import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { Pool } from "pg";
import type { Project, Message } from "@ai-wp/shared";

/**
 * Persistence layer (FND-06).
 *
 * The MVP spec (section 58) calls for Postgres backing the application
 * database, with WordPress keeping its own MySQL. This module is still the
 * *only* thing that changed to make that real: every call site in the repo
 * (routes, orchestrator, dispatcher, checkpoints, incremental edits) calls
 * the same synchronous `store.getProject` / `store.saveProject` API it
 * always has.
 *
 * Under the hood there are two modes:
 *  - No DATABASE_URL (default): everything reads/writes an in-memory cache
 *    that's mirrored to a JSON file on disk, exactly like the original
 *    single-file store -- zero external dependencies for `npm run dev`.
 *  - DATABASE_URL set: on startup, initStore() loads every project/message
 *    from Postgres into the same in-memory cache, and every write both
 *    updates the cache immediately (so callers stay synchronous) *and*
 *    fires an async upsert to Postgres. If Postgres is unreachable at
 *    startup, it falls back to the JSON file rather than failing to boot.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const DB_FILE = join(DATA_DIR, "projects.json");

interface DbShape {
  projects: Record<string, Project>;
  messages: Record<string, Message[]>;
}

let cache: DbShape = { projects: {}, messages: {} };
let pool: Pool | null = null;
let initialized = false;

/**
 * Backfills fields added after a project was first persisted (auditLog,
 * checkpoints, backups, and the REQ-07 spec/slot fields) so records written
 * before this backlog push don't crash the new code paths on read. Applied
 * on every read rather than as a one-time migration, so it's the same code
 * path whether the record came from the JSON file or Postgres.
 */
function normalizeProject(p: Project): Project {
  p.auditLog ??= [];
  p.checkpoints ??= [];
  p.backups ??= [];
  p.spec.ecommerce ??= { payment: null };
  p.spec.seo ??= false;
  p.spec.accessibility ??= false;
  p.spec.integrations ??= [];
  if (p.slots) {
    p.slots.ecommercePayment ??= null;
    p.slots.seo ??= null;
    p.slots.accessibility ??= null;
    p.slots.integrations ??= null;
  }
  return p;
}

function readJsonFile(): DbShape {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) {
    const empty: DbShape = { projects: {}, messages: {} };
    writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(readFileSync(DB_FILE, "utf-8")) as DbShape;
}

function persistJsonFile() {
  if (pool) return; // Postgres mode persists per-write instead (see below)
  writeFileSync(DB_FILE, JSON.stringify(cache, null, 2));
}

async function ensureSchema(p: Pool) {
  await p.query(
    `CREATE TABLE IF NOT EXISTS projects (
       id text PRIMARY KEY,
       data jsonb NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await p.query(
    `CREATE TABLE IF NOT EXISTS messages (
       id text PRIMARY KEY,
       project_id text NOT NULL,
       data jsonb NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await p.query(`CREATE INDEX IF NOT EXISTS messages_project_id_idx ON messages (project_id)`);
}

/** Call once at server startup, before accepting requests -- see server.ts. */
export async function initStore(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    cache = readJsonFile();
    console.log("[db] using the JSON file store (set DATABASE_URL to use Postgres instead)");
    return;
  }

  const candidate = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 4000 });
  try {
    await ensureSchema(candidate);
    const projectRows = await candidate.query<{ data: Project }>("SELECT data FROM projects");
    const loaded: DbShape = { projects: {}, messages: {} };
    for (const row of projectRows.rows) loaded.projects[row.data.id] = row.data;

    const messageRows = await candidate.query<{ project_id: string; data: Message }>(
      "SELECT project_id, data FROM messages ORDER BY created_at ASC",
    );
    for (const row of messageRows.rows) {
      (loaded.messages[row.project_id] ??= []).push(row.data);
    }

    cache = loaded;
    pool = candidate;
    console.log(`[db] Postgres store connected (${projectRows.rows.length} project(s) loaded)`);
  } catch (err) {
    console.warn(
      `[db] DATABASE_URL is set but Postgres wasn't reachable (${err instanceof Error ? err.message : err}) -- falling back to the JSON file store`,
    );
    await candidate.end().catch(() => undefined);
    cache = readJsonFile();
  }
}

export const store = {
  listProjects(): Project[] {
    return Object.values(cache.projects)
      .map(normalizeProject)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  getProject(id: string): Project | undefined {
    const project = cache.projects[id];
    return project ? normalizeProject(project) : undefined;
  },

  saveProject(project: Project): Project {
    project.updatedAt = new Date().toISOString();
    cache.projects[project.id] = project;
    if (pool) {
      pool
        .query(
          `INSERT INTO projects (id, data, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()`,
          [project.id, project],
        )
        .catch((err) => console.error(`[db] failed to persist project ${project.id}:`, err));
    } else {
      persistJsonFile();
    }
    return project;
  },

  deleteProject(id: string): void {
    delete cache.projects[id];
    delete cache.messages[id];
    if (pool) {
      pool.query("DELETE FROM projects WHERE id = $1", [id]).catch((err) => console.error("[db] failed to delete project:", err));
      pool.query("DELETE FROM messages WHERE project_id = $1", [id]).catch((err) => console.error("[db] failed to delete messages:", err));
    } else {
      persistJsonFile();
    }
  },

  listMessages(projectId: string): Message[] {
    return cache.messages[projectId] ?? [];
  },

  appendMessage(message: Message): void {
    if (!cache.messages[message.projectId]) cache.messages[message.projectId] = [];
    cache.messages[message.projectId].push(message);
    if (pool) {
      pool
        .query("INSERT INTO messages (id, project_id, data, created_at) VALUES ($1, $2, $3, now())", [
          message.id || nanoid(10),
          message.projectId,
          message,
        ])
        .catch((err) => console.error("[db] failed to persist message:", err));
    } else {
      persistJsonFile();
    }
  },
};
