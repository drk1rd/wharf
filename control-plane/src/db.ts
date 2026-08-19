import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = process.env.WHARF_DATA_DIR ?? path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "wharf.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  engine TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  container_id TEXT,
  volume_name TEXT,
  host_port INTEGER,
  username TEXT,
  password TEXT,
  database_name TEXT,
  cpu TEXT NOT NULL,
  memory_mb INTEGER NOT NULL,
  disk_gb INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (instance_id) REFERENCES instances(id)
);
`);

export interface InstanceRow {
  id: string;
  name: string;
  engine: string;
  version: string;
  status: "creating" | "running" | "stopped" | "error";
  container_id: string | null;
  volume_name: string | null;
  host_port: number | null;
  username: string | null;
  password: string | null;
  database_name: string | null;
  cpu: string;
  memory_mb: number;
  disk_gb: number;
  created_at: string;
  error: string | null;
}

export interface BackupRow {
  id: string;
  instance_id: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
}

export const instancesRepo = {
  insert(row: InstanceRow) {
    db.prepare(
      `INSERT INTO instances
        (id, name, engine, version, status, container_id, volume_name, host_port,
         username, password, database_name, cpu, memory_mb, disk_gb, created_at, error)
       VALUES (@id, @name, @engine, @version, @status, @container_id, @volume_name, @host_port,
         @username, @password, @database_name, @cpu, @memory_mb, @disk_gb, @created_at, @error)`
    ).run(row);
  },
  update(id: string, patch: Partial<InstanceRow>) {
    const fields = Object.keys(patch);
    if (fields.length === 0) return;
    const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
    db.prepare(`UPDATE instances SET ${setClause} WHERE id = @id`).run({ ...patch, id });
  },
  get(id: string): InstanceRow | undefined {
    return db.prepare(`SELECT * FROM instances WHERE id = ?`).get(id) as InstanceRow | undefined;
  },
  list(): InstanceRow[] {
    return db.prepare(`SELECT * FROM instances ORDER BY created_at DESC`).all() as InstanceRow[];
  },
  remove(id: string) {
    db.prepare(`DELETE FROM instances WHERE id = ?`).run(id);
  },
};

export const backupsRepo = {
  insert(row: BackupRow) {
    db.prepare(
      `INSERT INTO backups (id, instance_id, file_path, size_bytes, created_at)
       VALUES (@id, @instance_id, @file_path, @size_bytes, @created_at)`
    ).run(row);
  },
  listForInstance(instanceId: string): BackupRow[] {
    return db
      .prepare(`SELECT * FROM backups WHERE instance_id = ? ORDER BY created_at DESC`)
      .all(instanceId) as BackupRow[];
  },
  get(id: string): BackupRow | undefined {
    return db.prepare(`SELECT * FROM backups WHERE id = ?`).get(id) as BackupRow | undefined;
  },
};
