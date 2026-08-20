import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { backupsRepo, type BackupRow, type InstanceRow } from "./db.js";
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
