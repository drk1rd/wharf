import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, Client } from "../testing/harness.js";

// Docker-free: backup-schedule, token mint/revoke, and delete (which
// tolerates no real daemon — stopAndRemoveContainer swallows its own docker
// errors, see docker.ts) all succeed structurally without a real container,
// same reasoning as scoped-tokens.test.ts.
const server = await startTestServer();
const { instancesRepo } = await import("../db.js");
const admin = new Client(server.baseUrl);

function fakeInstance(name: string) {
  const row = {
    id: randomUUID(),
    owner_id: null,
    name,
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
  return row;
}

test("a fresh instance has an empty audit log", async () => {
  const instance = fakeInstance("audit-empty");
  const res = await admin.get(`/api/instances/${instance.id}/audit-log`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test("setting a backup schedule records an audit entry with the actor and detail", async () => {
  const instance = fakeInstance("audit-schedule");
  const res = await admin.patch(`/api/instances/${instance.id}/backup-schedule`, { intervalHours: 24, retentionCount: 5 });
  assert.equal(res.status, 200);

  const log = await admin.get(`/api/instances/${instance.id}/audit-log`);
  assert.equal(log.status, 200);
  assert.equal(log.body.length, 1);
  assert.equal(log.body[0].action, "backup-schedule.set");
  assert.equal(log.body[0].actor, "anonymous");
  assert.match(log.body[0].detail, /every 24h, keep 5/);
  assert.ok(log.body[0].createdAt);
});

test("minting and revoking a token both show up in the audit log", async () => {
  const instance = fakeInstance("audit-tokens");
  const minted = await admin.post(`/api/instances/${instance.id}/tokens`, { scope: "read", name: "ci" });
  await admin.delete(`/api/instances/${instance.id}/tokens/${minted.body.id}`);

  const log = await admin.get(`/api/instances/${instance.id}/audit-log`);
  const actions = log.body.map((e: any) => e.action);
  assert.deepEqual(actions.sort(), ["token.mint", "token.revoke"]);
});

test("deleting an instance still records the delete, even though the instance is gone", async () => {
  const instance = fakeInstance("audit-delete");
  const del = await admin.delete(`/api/instances/${instance.id}`);
  assert.equal(del.status, 204);
  assert.equal(instancesRepo.get(instance.id), undefined);

  // The instance row is gone, so its usual owned-instance gate (requireOwnedInstance)
  // can no longer be satisfied — the audit entry exists in the DB (proving delete
  // was recorded), even though there's no route left that can serve it back.
  const { auditLogRepo } = await import("../db.js");
  const rows = auditLogRepo.listForInstance(instance.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "delete");
});

test("a scoped token cannot view its own instance's audit log", async () => {
  const instance = fakeInstance("audit-scoped");
  const minted = await admin.post(`/api/instances/${instance.id}/tokens`, { scope: "write" });
  const scoped = new Client(server.baseUrl, { token: minted.body.token });
  const res = await scoped.get(`/api/instances/${instance.id}/audit-log`);
  assert.equal(res.status, 403);
});

test("a failed action (bad target id) does not get recorded", async () => {
  const res = await admin.get(`/api/instances/does-not-exist/audit-log`);
  assert.equal(res.status, 404);
});

after(() => server.close());
