import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = process.env.WHARF_DATA_DIR ?? path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "wharf.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  default_model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
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

// owner_id was added after instances first shipped — add it for anyone
// upgrading from an older Wharf without wiping their SQLite file.
const instanceColumns = db.prepare(`PRAGMA table_info(instances)`).all() as { name: string }[];
if (!instanceColumns.some((c) => c.name === "owner_id")) {
  db.exec(`ALTER TABLE instances ADD COLUMN owner_id TEXT`);
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  default_model: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export interface InstanceRow {
  id: string;
  owner_id: string | null;
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

export const usersRepo = {
  insert(row: UserRow) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, default_model, created_at)
       VALUES (@id, @email, @password_hash, @default_model, @created_at)`
    ).run(row);
  },
  getById(id: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  },
  getByEmail(email: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as UserRow | undefined;
  },
  update(id: string, patch: Partial<UserRow>) {
    const fields = Object.keys(patch);
    if (fields.length === 0) return;
    const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
    db.prepare(`UPDATE users SET ${setClause} WHERE id = @id`).run({ ...patch, id });
  },
};

export const sessionsRepo = {
  insert(row: SessionRow) {
    db.prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (@id, @user_id, @created_at, @expires_at)`).run(row);
  },
  get(id: string): SessionRow | undefined {
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
  },
  remove(id: string) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  },
  removeExpired() {
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
  },
};

export const instancesRepo = {
  insert(row: InstanceRow) {
    db.prepare(
      `INSERT INTO instances
        (id, owner_id, name, engine, version, status, container_id, volume_name, host_port,
         username, password, database_name, cpu, memory_mb, disk_gb, created_at, error)
       VALUES (@id, @owner_id, @name, @engine, @version, @status, @container_id, @volume_name, @host_port,
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
  /** Every instance, regardless of owner — for the WHARF_TOKEN admin/service path and internal bookkeeping (e.g. the instance cap). */
  list(): InstanceRow[] {
    return db.prepare(`SELECT * FROM instances ORDER BY created_at DESC`).all() as InstanceRow[];
  },
  /** What a signed-in user sees: their own instances, plus any created outside a user session (owner_id IS NULL). */
  listForOwner(ownerId: string): InstanceRow[] {
    return db
      .prepare(`SELECT * FROM instances WHERE owner_id = ? OR owner_id IS NULL ORDER BY created_at DESC`)
      .all(ownerId) as InstanceRow[];
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
  removeForInstance(instanceId: string) {
    db.prepare(`DELETE FROM backups WHERE instance_id = ?`).run(instanceId);
  },
};
