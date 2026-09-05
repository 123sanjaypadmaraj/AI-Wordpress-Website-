import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { Project, ProjectBackup, ProjectCheckpoint } from "@ai-wp/shared";
import { projectDir, composeCp, execWpCli } from "../docker/compose.js";
import { store } from "../db/store.js";

/**
 * VER-02/VER-04: checkpoints (spec snapshot + DB dump, cheap and automatic)
 * and standalone backups (DB dump + wp-content archive, heavier, on
 * request). Both dump the DB the same way -- `wp db export` inside the
 * wpcli container, then `docker compose cp` the file out to the project's
 * own directory so it survives the container being destroyed.
 */

const MAX_AUTO_CHECKPOINTS = 10;

function checkpointDir(projectId: string) {
  const dir = join(projectDir(projectId), "checkpoints");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function backupDir(projectId: string) {
  const dir = join(projectDir(projectId), "backups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function dumpDatabase(project: Project, destFile: string): Promise<void> {
  const remoteFile = `/tmp/dump-${nanoid(6)}.sql`;
  await execWpCli(project.id, ["db", "export", remoteFile]);
  await composeCp(project.id, `wpcli:${remoteFile}`, destFile);
  await execWpCli(project.id, ["eval", `@unlink('${remoteFile}');`]).catch(() => undefined);
}

async function restoreDatabase(project: Project, sourceFile: string): Promise<void> {
  const remoteFile = `/tmp/restore-${nanoid(6)}.sql`;
  await composeCp(project.id, sourceFile, `wpcli:${remoteFile}`);
  await execWpCli(project.id, ["db", "import", remoteFile]);
  await execWpCli(project.id, ["eval", `@unlink('${remoteFile}');`]).catch(() => undefined);
}

export async function createCheckpoint(
  project: Project,
  label: string,
  kind: "auto" | "manual" = "auto",
): Promise<ProjectCheckpoint> {
  const id = nanoid(10);
  let dbDumpFile: string | null = null;

  if (project.docker.status === "running") {
    const dir = checkpointDir(project.id);
    const file = join(dir, `${id}.sql`);
    try {
      await dumpDatabase(project, file);
      dbDumpFile = file;
    } catch {
      dbDumpFile = null; // spec snapshot alone still has value even if the DB dump failed
    }
  }

  const checkpoint: ProjectCheckpoint = {
    id,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    label,
    kind,
    spec: JSON.parse(JSON.stringify(project.spec)),
    dbDumpFile,
  };

  project.checkpoints.push(checkpoint);
  if (kind === "auto") {
    const autos = project.checkpoints.filter((c) => c.kind === "auto");
    if (autos.length > MAX_AUTO_CHECKPOINTS) {
      const toDrop = autos.slice(0, autos.length - MAX_AUTO_CHECKPOINTS).map((c) => c.id);
      project.checkpoints = project.checkpoints.filter((c) => !toDrop.includes(c.id));
    }
  }
  store.saveProject(project);
  return checkpoint;
}

export async function restoreCheckpoint(project: Project, checkpointId: string): Promise<void> {
  const checkpoint = project.checkpoints.find((c) => c.id === checkpointId);
  if (!checkpoint) throw new Error("Checkpoint not found");
  if (checkpoint.dbDumpFile && existsSync(checkpoint.dbDumpFile) && project.docker.status === "running") {
    await restoreDatabase(project, checkpoint.dbDumpFile);
  }
  project.spec = JSON.parse(JSON.stringify(checkpoint.spec));
  store.saveProject(project);
}

/** VER-04: DB + wp-content filesystem backup, independent of the auto-checkpoint trail. */
export async function createBackup(project: Project, label: string): Promise<ProjectBackup> {
  if (project.docker.status !== "running") throw new Error("Environment must be running to back it up");
  const id = nanoid(10);
  const dir = backupDir(project.id);
  const dbDumpFile = join(dir, `${id}.sql`);
  await dumpDatabase(project, dbDumpFile);

  const filesArchive = join(dir, `${id}-wp-content.tar.gz`);
  const remoteArchive = `/tmp/wp-content-${id}.tar.gz`;
  await execWpCli(project.id, ["eval", `exec('cd /var/www/html && tar czf ${remoteArchive} wp-content');`]);
  await composeCp(project.id, `wpcli:${remoteArchive}`, filesArchive).catch(() => undefined);
  await execWpCli(project.id, ["eval", `@unlink('${remoteArchive}');`]).catch(() => undefined);

  const backup: ProjectBackup = {
    id,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    label,
    dbDumpFile,
    filesArchive: existsSync(filesArchive) ? filesArchive : null,
  };
  project.backups.push(backup);
  store.saveProject(project);
  return backup;
}

export async function restoreBackup(project: Project, backupId: string): Promise<void> {
  const backup = project.backups.find((b) => b.id === backupId);
  if (!backup) throw new Error("Backup not found");
  if (project.docker.status !== "running") throw new Error("Environment must be running to restore into it");
  await restoreDatabase(project, backup.dbDumpFile);
  if (backup.filesArchive && existsSync(backup.filesArchive)) {
    const remoteArchive = `/tmp/restore-wp-content-${backup.id}.tar.gz`;
    await composeCp(project.id, backup.filesArchive, `wpcli:${remoteArchive}`);
    await execWpCli(project.id, ["eval", `exec('cd /var/www/html && tar xzf ${remoteArchive}');`]);
    await execWpCli(project.id, ["eval", `@unlink('${remoteArchive}');`]).catch(() => undefined);
  }
}
