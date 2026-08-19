import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { backupsRepo, type BackupRow, type InstanceRow } from "./db.js";
import { getManifest } from "./manifests/registry.js";
import type { InstanceSecrets } from "./manifests/types.js";
import { execCapture, execWithStdin } from "./docker.js";

const dataDir = process.env.WHARF_DATA_DIR ?? path.join(process.cwd(), "data");
const backupsDir = path.join(dataDir, "backups");

function secretsOf(row: InstanceRow): InstanceSecrets {
  if (!row.username || !row.password || !row.database_name) {
    throw new Error("instance has no credentials on record");
  }
  return { username: row.username, password: row.password, database: row.database_name };
}

export async function createBackup(row: InstanceRow): Promise<BackupRow> {
  const manifest = getManifest(row.engine);
  if (!manifest) throw new Error(`unknown engine: ${row.engine}`);
  if (!row.container_id) throw new Error("instance has no running container");

  const secrets = secretsOf(row);
  const dump = await execCapture(row.container_id, manifest.backup.dumpCmd(secrets));

  const instanceDir = path.join(backupsDir, row.id);
  await fs.mkdir(instanceDir, { recursive: true });
  const id = randomUUID();
  const filePath = path.join(instanceDir, `${id}.${manifest.backup.fileExt}`);
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

export async function restoreBackup(row: InstanceRow, backupId: string): Promise<void> {
  const manifest = getManifest(row.engine);
  if (!manifest) throw new Error(`unknown engine: ${row.engine}`);
  if (!row.container_id) throw new Error("instance has no running container");

  const backup = backupsRepo.get(backupId);
  if (!backup || backup.instance_id !== row.id) throw new Error("backup not found for this instance");

  const secrets = secretsOf(row);
  const data = await fs.readFile(backup.file_path);
  await execWithStdin(row.container_id, manifest.backup.restoreCmd(secrets), data);
}
