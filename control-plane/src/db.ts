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
  is_superadmin INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS backup_schedules (
  instance_id TEXT PRIMARY KEY,
  interval_hours INTEGER NOT NULL,
  retention_count INTEGER NOT NULL,
  last_run_at TEXT,
  FOREIGN KEY (instance_id) REFERENCES instances(id)
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (instance_id) REFERENCES instances(id)
);

-- No FOREIGN KEY here, unlike the tables above: a "delete" entry must
-- survive the instance row it refers to being removed, or the audit trail
-- would lose the one event that matters most to have a record of.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`);

// owner_id was added after instances first shipped — add it for anyone
// upgrading from an older Wharf without wiping their SQLite file.
const instanceColumns = db.prepare(`PRAGMA table_info(instances)`).all() as { name: string }[];
if (!instanceColumns.some((c) => c.name === "owner_id")) {
  db.exec(`ALTER TABLE instances ADD COLUMN owner_id TEXT`);
}

// is_superadmin was added after users first shipped — same reasoning as
// owner_id above, so an existing self-hosted install's first-ever account
// (which predates the mandatory first-boot setup flow) doesn't silently
// become un-promotable to superadmin.
const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
if (!userColumns.some((c) => c.name === "is_superadmin")) {
  db.exec(`ALTER TABLE users ADD COLUMN is_superadmin INTEGER NOT NULL DEFAULT 0`);
  // An install upgrading from before this column existed may already have
  // accounts with no superadmin among them — granting superadmin requires
  // already being superadmin, so without this, upgrading would strand
  // everyone with no way to reach the new management surface at all.
  // Promote whoever signed up first, same as a fresh install's first signup.
  db.exec(`UPDATE users SET is_superadmin = 1 WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)`);
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  default_model: string | null;
  is_superadmin: number;
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

export interface BackupScheduleRow {
  instance_id: string;
  interval_hours: number;
  retention_count: number;
  last_run_at: string | null;
}

export interface ApiTokenRow {
  id: string;
  instance_id: string;
  token_hash: string;
  scope: "read" | "write";
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface AuditLogRow {
  id: string;
  instance_id: string;
  actor: string;
  action: string;
  detail: string | null;
  created_at: string;
}

export const usersRepo = {
  insert(row: UserRow) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, default_model, is_superadmin, created_at)
       VALUES (@id, @email, @password_hash, @default_model, @is_superadmin, @created_at)`
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
  /** Every account — the admin user-management panel is the only caller. */
  list(): UserRow[] {
    return db.prepare(`SELECT * FROM users ORDER BY created_at ASC`).all() as UserRow[];
  },
  remove(id: string) {
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  },
  count(): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  },
  countSuperadmins(): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_superadmin = 1`).get() as { n: number }).n;
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
  /** Used when an admin deletes a user's account — signs out any session they still hold. */
  removeForUser(userId: string) {
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
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
  /**
   * Exactly this owner's instances — unlike listForOwner, does NOT also
   * include ownerless ones. Used only by admin user-deletion, to reassign
   * (not display) what a removed account leaves behind.
   */
  listOwnedBy(ownerId: string): InstanceRow[] {
    return db.prepare(`SELECT * FROM instances WHERE owner_id = ?`).all(ownerId) as InstanceRow[];
  },
  countOwnedBy(ownerId: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM instances WHERE owner_id = ?`).get(ownerId) as { n: number }).n;
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
  remove(id: string) {
    db.prepare(`DELETE FROM backups WHERE id = ?`).run(id);
  },
};

export const backupSchedulesRepo = {
  upsert(row: BackupScheduleRow) {
    db.prepare(
      `INSERT INTO backup_schedules (instance_id, interval_hours, retention_count, last_run_at)
       VALUES (@instance_id, @interval_hours, @retention_count, @last_run_at)
       ON CONFLICT(instance_id) DO UPDATE SET
         interval_hours = excluded.interval_hours,
         retention_count = excluded.retention_count`
    ).run(row);
  },
  get(instanceId: string): BackupScheduleRow | undefined {
    return db.prepare(`SELECT * FROM backup_schedules WHERE instance_id = ?`).get(instanceId) as BackupScheduleRow | undefined;
  },
  list(): BackupScheduleRow[] {
    return db.prepare(`SELECT * FROM backup_schedules`).all() as BackupScheduleRow[];
  },
  updateLastRun(instanceId: string, lastRunAt: string) {
    db.prepare(`UPDATE backup_schedules SET last_run_at = ? WHERE instance_id = ?`).run(lastRunAt, instanceId);
  },
  remove(instanceId: string) {
    db.prepare(`DELETE FROM backup_schedules WHERE instance_id = ?`).run(instanceId);
  },
};

export const apiTokensRepo = {
  insert(row: ApiTokenRow) {
    db.prepare(
      `INSERT INTO api_tokens (id, instance_id, token_hash, scope, name, created_at, last_used_at)
       VALUES (@id, @instance_id, @token_hash, @scope, @name, @created_at, @last_used_at)`
    ).run(row);
  },
  getByHash(tokenHash: string): ApiTokenRow | undefined {
    return db.prepare(`SELECT * FROM api_tokens WHERE token_hash = ?`).get(tokenHash) as ApiTokenRow | undefined;
  },
  listForInstance(instanceId: string): ApiTokenRow[] {
    return db.prepare(`SELECT * FROM api_tokens WHERE instance_id = ? ORDER BY created_at DESC`).all(instanceId) as ApiTokenRow[];
  },
  touch(id: string, lastUsedAt: string) {
    db.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).run(lastUsedAt, id);
  },
  /** Scoped to instanceId too, so a token ID for a different instance can't be revoked through this path. */
  remove(id: string, instanceId: string) {
    db.prepare(`DELETE FROM api_tokens WHERE id = ? AND instance_id = ?`).run(id, instanceId);
  },
  removeForInstance(instanceId: string) {
    db.prepare(`DELETE FROM api_tokens WHERE instance_id = ?`).run(instanceId);
  },
};

export const auditLogRepo = {
  insert(row: AuditLogRow) {
    db.prepare(
      `INSERT INTO audit_log (id, instance_id, actor, action, detail, created_at)
       VALUES (@id, @instance_id, @actor, @action, @detail, @created_at)`
    ).run(row);
  },
  listForInstance(instanceId: string, limit = 200): AuditLogRow[] {
    return db
      .prepare(`SELECT * FROM audit_log WHERE instance_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(instanceId, limit) as AuditLogRow[];
  },
};
