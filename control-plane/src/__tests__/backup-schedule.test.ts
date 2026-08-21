import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { startTestServer, Client, setupSuperadmin } from "../testing/harness.js";

// Route-level validation and the schedule CRUD, all without touching
// Docker — same bypass pattern as ownership.test.ts. Actually running a
// scheduled backup against a real container is exercised for real in
// engines.integration.test.ts.
const server = await startTestServer();
const { instancesRepo } = await import("../db.js");
const { setBackupSchedule, getBackupSchedule, runDueBackups, pruneBackups } = await import("../backups.js");
const { backupsRepo } = await import("../db.js");
const client = await setupSuperadmin(server);

const row = {
  id: randomUUID(),
  owner_id: null,
  name: "schedule-test",
  engine: "postgres",
  version: "16",
  status: "running" as const,
  container_id: "fake-container",
  volume_name: "fake-volume",
  host_port: 55432,
  username: "wharf",
  password: "not-a-real-secret",
  database_name: "app",
  cpu: "1",
  memory_mb: 512,
  disk_gb: 2,
  created_at: new Date().toISOString(),
  error: null,
};
instancesRepo.insert(row);

test("a fresh instance has no backup schedule", async () => {
  const res = await client.get(`/api/instances/${row.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.backupSchedule, null);
});

test("PATCH backup-schedule enables a schedule and it's reflected on the instance", async () => {
  const res = await client.patch(`/api/instances/${row.id}/backup-schedule`, { intervalHours: 24, retentionCount: 5 });
  assert.equal(res.status, 200);
  assert.equal(res.body.intervalHours, 24);
  assert.equal(res.body.retentionCount, 5);
  assert.equal(res.body.lastRunAt, null);

  const fetched = await client.get(`/api/instances/${row.id}`);
  assert.deepEqual(fetched.body.backupSchedule, { intervalHours: 24, retentionCount: 5, lastRunAt: null });
});

test("PATCH backup-schedule rejects an out-of-range interval", async () => {
  const res = await client.patch(`/api/instances/${row.id}/backup-schedule`, { intervalHours: 0, retentionCount: 5 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /intervalHours/);
});

test("PATCH backup-schedule with intervalHours: null disables it", async () => {
  const res = await client.patch(`/api/instances/${row.id}/backup-schedule`, { intervalHours: null });
  assert.equal(res.status, 200);
  assert.equal(res.body, null);
  assert.equal(getBackupSchedule(row.id), null);
});

test("runDueBackups skips an instance that isn't running", async () => {
  setBackupSchedule(row.id, 1, 3);
  instancesRepo.update(row.id, { status: "error" });
  await runDueBackups((id) => instancesRepo.get(id));
  // Never ran — last_run_at stays null since the instance wasn't running.
  assert.equal(getBackupSchedule(row.id)?.last_run_at, null);
  instancesRepo.update(row.id, { status: "running" });
});

test("pruneBackups deletes the oldest backups (DB row + file) beyond retentionCount", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wharf-prune-test-"));
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    const filePath = path.join(dir, `${id}.txt`);
    await fs.writeFile(filePath, `backup ${i}`);
    backupsRepo.insert({
      id,
      instance_id: row.id,
      file_path: filePath,
      size_bytes: 10,
      // listForInstance orders by created_at DESC — spread timestamps so
      // order is deterministic instead of relying on insertion order.
      created_at: new Date(Date.now() + i * 1000).toISOString(),
    });
    ids.push(id);
  }

  await pruneBackups(row.id, 2);

  const remaining = backupsRepo.listForInstance(row.id);
  assert.deepEqual(
    remaining.map((b) => b.id).sort(),
    [ids[2], ids[3]].sort(),
    "only the 2 newest backups should remain"
  );
  await assert.rejects(fs.access(path.join(dir, `${ids[0]}.txt`)), "the oldest backup's file should be deleted");
  await assert.doesNotReject(fs.access(path.join(dir, `${ids[3]}.txt`)), "the newest backup's file should still exist");
});

after(() => server.close());
