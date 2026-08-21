import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { backupsRepo, backupSchedulesRepo, type BackupRow, type BackupScheduleRow, type InstanceRow } from "./db.js";
import { getManifest } from "./manifests/registry.js";
import type { InstanceSecrets } from "./manifests/types.js";
import { execCapture, execWithStdin } from "./docker.js";
import { internalConnectionString } from "./instances.js";
import { getBrowserAdapter } from "./browser/registry.js";

const dataDir = process.env.WHARF_DATA_DIR ?? path.join(process.cwd(), "data");
const backupsDir = path.join(dataDir, "backups");

function secretsOf(row: InstanceRow): InstanceSecrets {
  if (!row.username || !row.password || !row.database_name) {
    throw new Error("instance has no credentials on record");
  }
  return { username: row.username, password: row.password, database: row.database_name };
}

export function backupSupported(engine: string): boolean {
  const manifest = getManifest(engine);
  if (!manifest) return false;
  return Boolean(manifest.backup) || Boolean(getBrowserAdapter(manifest.browserAdapter).dumpAll);
}

function unsupportedError(displayName: string): Error {
  const err = new Error(`backup/restore is not supported for ${displayName} yet`);
  (err as Error & { status?: number }).status = 400;
  return err;
}

export async function createBackup(row: InstanceRow): Promise<BackupRow> {
  const manifest = getManifest(row.engine);
  if (!manifest) throw new Error(`unknown engine: ${row.engine}`);
  if (!row.container_id) throw new Error("instance has no running container");

  let dump: Buffer;
  let fileExt: string;

  if (manifest.backup) {
    const secrets = secretsOf(row);
    dump = await execCapture(row.container_id, manifest.backup.dumpCmd(secrets));
    fileExt = manifest.backup.fileExt;
  } else {
    const adapter = getBrowserAdapter(manifest.browserAdapter);
    if (!adapter.dumpAll) throw unsupportedError(manifest.displayName);
    const connectionString = internalConnectionString(row);
    if (!connectionString) throw new Error("instance has no connection info yet");
    dump = await adapter.dumpAll(connectionString);
    fileExt = "json";
  }

  const instanceDir = path.join(backupsDir, row.id);
  await fs.mkdir(instanceDir, { recursive: true });
  const id = randomUUID();
  const filePath = path.join(instanceDir, `${id}.${fileExt}`);
  await fs.writeFile(filePath, dump);

  const backupRow: BackupRow = {
    id,
    instance_id: row.id,
    file_path: filePath,
    size_bytes: dump.byteLength,
    created_at: new Date().toISOString(),
  };
  backupsRepo.insert(backupRow);
  return backupRow;
}

export function listBackups(instanceId: string): BackupRow[] {
  return backupsRepo.listForInstance(instanceId);
}

/**
 * `backups.instance_id` has a foreign key on `instances.id` with no cascade
 * (found for real in CI: every instance delete 500'd with a FOREIGN KEY
 * constraint failure the moment a backup existed for it), so a backup's
 * file and DB row must both go before the instance row can be removed.
 */
export async function deleteBackupsForInstance(instanceId: string): Promise<void> {
  const backups = backupsRepo.listForInstance(instanceId);
  await Promise.all(backups.map((b) => fs.rm(b.file_path, { force: true })));
  backupsRepo.removeForInstance(instanceId);
  backupSchedulesRepo.remove(instanceId);
}

function badRequest(message: string): never {
  const err = new Error(message);
  (err as Error & { status?: number }).status = 400;
  throw err;
}

/**
 * Enable/update a recurring backup schedule, or disable it entirely
 * (intervalHours: null). retentionCount caps how many backups are kept for
 * this instance — the oldest are pruned (DB row + file) once a new one lands.
 */
export function setBackupSchedule(instanceId: string, intervalHours: number | null, retentionCount: number): BackupScheduleRow | null {
  if (intervalHours === null) {
    backupSchedulesRepo.remove(instanceId);
    return null;
  }
  if (!Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 24 * 30) {
    badRequest("intervalHours must be between 1 and 720 (30 days), or null to disable");
  }
  if (!Number.isFinite(retentionCount) || retentionCount < 1 || retentionCount > 100) {
    badRequest("retentionCount must be between 1 and 100");
  }
  const existing = backupSchedulesRepo.get(instanceId);
  backupSchedulesRepo.upsert({
    instance_id: instanceId,
    interval_hours: intervalHours,
    retention_count: retentionCount,
    last_run_at: existing?.last_run_at ?? null,
  });
  return backupSchedulesRepo.get(instanceId) ?? null;
}

export function getBackupSchedule(instanceId: string): BackupScheduleRow | null {
  return backupSchedulesRepo.get(instanceId) ?? null;
}

/** Deletes the oldest backups (DB row + file) beyond retentionCount, newest-first kept. */
export async function pruneBackups(instanceId: string, retentionCount: number): Promise<void> {
  const backups = backupsRepo.listForInstance(instanceId); // newest first
  const toRemove = backups.slice(retentionCount);
  for (const backup of toRemove) {
    await fs.rm(backup.file_path, { force: true });
    backupsRepo.remove(backup.id);
  }
}

/**
 * Runs every due scheduled backup once. Best-effort per instance — one
 * instance's engine being unreachable or mid-restart doesn't stop the rest
 * from getting backed up on this tick; it just tries again next tick.
 */
export async function runDueBackups(getInstance: (id: string) => InstanceRow | undefined): Promise<void> {
  for (const schedule of backupSchedulesRepo.list()) {
    const dueAt = schedule.last_run_at ? new Date(schedule.last_run_at).getTime() + schedule.interval_hours * 3_600_000 : 0;
    if (Date.now() < dueAt) continue;

    const row = getInstance(schedule.instance_id);
    if (!row || row.status !== "running") continue;

    try {
      await createBackup(row);
      backupSchedulesRepo.updateLastRun(schedule.instance_id, new Date().toISOString());
      await pruneBackups(schedule.instance_id, schedule.retention_count);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[wharf] scheduled backup failed for instance ${schedule.instance_id}:`, err instanceof Error ? err.message : err);
    }
  }
}

export async function restoreBackup(row: InstanceRow, backupId: string): Promise<void> {
  const manifest = getManifest(row.engine);
  if (!manifest) throw new Error(`unknown engine: ${row.engine}`);
  if (!row.container_id) throw new Error("instance has no running container");

  const backup = backupsRepo.get(backupId);
  if (!backup || backup.instance_id !== row.id) throw new Error("backup not found for this instance");
  const data = await fs.readFile(backup.file_path);

  if (manifest.backup) {
    const secrets = secretsOf(row);
    await execWithStdin(row.container_id, manifest.backup.restoreCmd(secrets), data);
    return;
  }

  const adapter = getBrowserAdapter(manifest.browserAdapter);
  if (!adapter.restoreAll) throw unsupportedError(manifest.displayName);
  const connectionString = internalConnectionString(row);
  if (!connectionString) throw new Error("instance has no connection info yet");
  await adapter.restoreAll(connectionString, data);
}
