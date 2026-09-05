import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { DockerEnvironment, Project } from "@ai-wp/shared";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const TEMPLATE_PATH = join(REPO_ROOT, "infrastructure", "docker", "templates", "docker-compose.template.yml");
const PROJECTS_DIR = join(REPO_ROOT, "infrastructure", "docker", "projects");

const PORT_RANGE_START = 8100;
const PORT_RANGE_END = 8399;

/** Per-project generated compose file + secrets, isolated by directory (section 37). Exported so tools/ modules (screenshots, checkpoints, exports, child themes) share one path convention. */
export function projectDir(projectId: string) {
  return join(PROJECTS_DIR, projectId);
}

export { PROJECTS_DIR };

function prefixFor(projectId: string) {
  return `aiwp-${projectId.slice(0, 8)}`;
}

function usedPorts(): Set<number> {
  const used = new Set<number>();
  if (!existsSync(PROJECTS_DIR)) return used;
  for (const dir of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const envFile = join(PROJECTS_DIR, dir.name, ".env");
    if (!existsSync(envFile)) continue;
    const content = readFileSync(envFile, "utf-8");
    const match = content.match(/WP_PORT=(\d+)/);
    if (match) used.add(Number(match[1]));
  }
  return used;
}

function allocatePort(): number {
  const used = usedPorts();
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error("No free ports left in the WordPress preview range");
}

function secret(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

interface RenderedEnv {
  dir: string;
  prefix: string;
  wpPort: number;
  composeProject: string;
}

function renderCompose(projectId: string): RenderedEnv {
  const dir = projectDir(projectId);
  mkdirSync(dir, { recursive: true });

  const prefix = prefixFor(projectId);
  const wpPort = allocatePort();
  const dbName = "wordpress";
  const dbUser = "wordpress";
  const dbPassword = secret(12);
  const dbRootPassword = secret(12);
  const composeProject = prefix;

  const template = readFileSync(TEMPLATE_PATH, "utf-8");
  const rendered = template
    .replaceAll("__COMPOSE_PROJECT__", composeProject)
    .replaceAll("__PREFIX__", prefix)
    .replaceAll("__WP_PORT__", String(wpPort))
    .replaceAll("__DB_NAME__", dbName)
    .replaceAll("__DB_USER__", dbUser)
    .replaceAll("__DB_PASSWORD__", dbPassword)
    .replaceAll("__DB_ROOT_PASSWORD__", dbRootPassword);

  writeFileSync(join(dir, "docker-compose.yml"), rendered);

  // Secrets live only in this project-scoped .env, never sent to the LLM or
  // the frontend (spec sections 15 & 38: credentials must not be exposed
  // to the model unnecessarily).
  const adminPassword = secret(8);
  writeFileSync(
    join(dir, ".env"),
    [
      `WP_PORT=${wpPort}`,
      `DB_NAME=${dbName}`,
      `DB_USER=${dbUser}`,
      `DB_PASSWORD=${dbPassword}`,
      `DB_ROOT_PASSWORD=${dbRootPassword}`,
      `WP_ADMIN_USER=admin`,
      `WP_ADMIN_PASSWORD=${adminPassword}`,
      `WP_ADMIN_EMAIL=admin@example.local`,
    ].join("\n") + "\n",
  );

  return { dir, prefix, wpPort, composeProject };
}

export async function compose(dir: string, args: string[]) {
  return execFileAsync("docker", ["compose", ...args], { cwd: dir, timeout: 5 * 60_000 });
}

/** `docker compose cp` in either direction -- used by the child-theme (GEN-07) and export (EXP-01/02) tools to move files in/out of the wpcli container without a shell. */
export async function composeCp(projectId: string, source: string, dest: string) {
  const dir = projectDir(projectId);
  return execFileAsync("docker", ["compose", "cp", source, dest], { cwd: dir, timeout: 60_000 });
}

export function readProjectSecret(projectId: string, key: string): string | null {
  const envFile = join(projectDir(projectId), ".env");
  if (!existsSync(envFile)) return null;
  const match = readFileSync(envFile, "utf-8").match(new RegExp(`${key}=(.*)`));
  return match ? match[1] : null;
}

export function execWpCli(projectId: string, args: string[]) {
  const dir = projectDir(projectId);
  return execFileAsync(
    "docker",
    ["compose", "exec", "-T", "wpcli", "wp", "--path=/var/www/html", ...args],
    { cwd: dir, timeout: 2 * 60_000 },
  );
}

export interface CreateResult {
  docker: DockerEnvironment;
  log: string[];
}

export async function createWordPressEnvironment(project: Project): Promise<CreateResult> {
  const log: string[] = [];
  const { dir, prefix, wpPort } = renderCompose(project.id);
  log.push(`Rendered docker-compose.yml (port ${wpPort}, prefix ${prefix})`);

  try {
    await compose(dir, ["up", "-d", "--wait"]);
    log.push("Containers started and healthy (wordpress, db, wpcli)");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      log: [...log, `docker compose up failed: ${message}`],
      docker: {
        projectId: project.id,
        status: "error",
        wpPort,
        containerPrefix: prefix,
        previewUrl: null,
        adminUrl: null,
        createdAt: null,
        lastError: message,
      },
    };
  }

  const previewUrl = `http://localhost:${wpPort}`;
  return {
    log,
    docker: {
      projectId: project.id,
      status: "running",
      wpPort,
      containerPrefix: prefix,
      previewUrl,
      adminUrl: `${previewUrl}/wp-admin`,
      createdAt: new Date().toISOString(),
      lastError: null,
    },
  };
}

export async function stopEnvironment(project: Project) {
  const dir = projectDir(project.id);
  await compose(dir, ["stop"]);
}

export async function startEnvironment(project: Project) {
  const dir = projectDir(project.id);
  await compose(dir, ["start"]);
}

/** DOCK-05: restart endpoint's underlying primitive -- a plain `stop` + `start` rather than `docker compose restart` so a healthcheck-gated `up --wait` isn't needed (containers already exist). */
export async function restartEnvironment(project: Project) {
  const dir = projectDir(project.id);
  await compose(dir, ["restart"]);
}

export async function destroyEnvironment(project: Project) {
  const dir = projectDir(project.id);
  await compose(dir, ["down", "-v"]);
}
