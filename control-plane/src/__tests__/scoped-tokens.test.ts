import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, Client } from "../testing/harness.js";

// Docker-free by design: everything here either short-circuits before
// touching a real container (requireWriteAccess throws first for a
// read-scoped token) or exercises a path that tolerates no daemon being
// present (stopAndRemoveContainer swallows its own docker errors — see
// docker.ts), same reasoning as import-route.test.ts and ownership.test.ts.
const server = await startTestServer();
const { instancesRepo } = await import("../db.js");
const admin = new Client(server.baseUrl); // anonymous bootstrap mode — full access, same as ownership.test.ts's pattern

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

const instanceA = fakeInstance("token-test-a");
const instanceB = fakeInstance("token-test-b");

test("minting a token returns the plaintext token once, plus metadata", async () => {
  const res = await admin.post(`/api/instances/${instanceA.id}/tokens`, { scope: "read", name: "ci-reader" });
  assert.equal(res.status, 201);
  assert.ok(typeof res.body.token === "string" && res.body.token.startsWith("wst_"));
  assert.equal(res.body.scope, "read");
  assert.equal(res.body.name, "ci-reader");
});

test("a listed token never includes the plaintext token", async () => {
  const listed = await admin.get(`/api/instances/${instanceA.id}/tokens`);
  assert.equal(listed.status, 200);
  assert.ok(listed.body.length >= 1);
  for (const t of listed.body) {
    assert.equal("token" in t, false);
  }
});

test("a read-scoped token can read its own instance but not mutate it", async () => {
  const minted = await admin.post(`/api/instances/${instanceA.id}/tokens`, { scope: "read" });
  const reader = new Client(server.baseUrl, { token: minted.body.token });

  const got = await reader.get(`/api/instances/${instanceA.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.id, instanceA.id);

  const objects = await reader.get(`/api/instances/${instanceA.id}/browse/objects`);
  // A real 200/500 both prove the request got past auth to the (docker-less)
  // adapter layer — only a 403 here would mean read access was wrongly denied.
  assert.notEqual(objects.status, 403);

  for (const attempt of [
    () => reader.delete(`/api/instances/${instanceA.id}`),
    () => reader.patch(`/api/instances/${instanceA.id}/resize`, { cpu: "2" }),
    () => reader.post(`/api/instances/${instanceA.id}/backups`),
    () => reader.post(`/api/instances/${instanceA.id}/restore`, { backupId: "x" }),
    () => reader.patch(`/api/instances/${instanceA.id}/backup-schedule`, { intervalHours: 24, retentionCount: 5 }),
    () => reader.post(`/api/instances/${instanceA.id}/browse/query`, { query: "SELECT 1" }),
    () => reader.post(`/api/instances/${instanceA.id}/browse/import`, { format: "json", target: "t", data: "[]" }),
  ]) {
    const res = await attempt();
    assert.equal(res.status, 403, `expected a read-only token to be rejected: ${JSON.stringify(res.body)}`);
  }
});

test("a read-scoped token cannot see or touch a different instance", async () => {
  const minted = await admin.post(`/api/instances/${instanceA.id}/tokens`, { scope: "read" });
  const reader = new Client(server.baseUrl, { token: minted.body.token });

  const got = await reader.get(`/api/instances/${instanceB.id}`);
  assert.equal(got.status, 404);

  const list = await reader.get(`/api/instances`);
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.map((i: any) => i.id),
    [instanceA.id]
  );
});

test("a write-scoped token can mutate its own instance but still can't create new ones", async () => {
  const minted = await admin.post(`/api/instances/${instanceB.id}/tokens`, { scope: "write" });
  const writer = new Client(server.baseUrl, { token: minted.body.token });

  const created = await writer.post(`/api/instances`, { engine: "postgres" });
  assert.equal(created.status, 403);

  // DELETE tolerates no real Docker daemon (stopAndRemoveContainer swallows
  // its own errors), so a clean 204 here proves the write-scope gate passed
  // rather than getting stuck behind a real-infra failure.
  const del = await writer.delete(`/api/instances/${instanceB.id}`);
  assert.equal(del.status, 204);
  assert.equal(instancesRepo.get(instanceB.id), undefined);
});

test("a scoped token cannot mint, list, or revoke tokens for its own instance", async () => {
  const minted = await admin.post(`/api/instances/${instanceA.id}/tokens`, { scope: "write" });
  const writer = new Client(server.baseUrl, { token: minted.body.token });

  assert.equal((await writer.post(`/api/instances/${instanceA.id}/tokens`, { scope: "write" })).status, 403);
  assert.equal((await writer.get(`/api/instances/${instanceA.id}/tokens`)).status, 403);
  assert.equal((await writer.delete(`/api/instances/${instanceA.id}/tokens/${minted.body.id}`)).status, 403);
});

test("a revoked token is no longer listed", async () => {
  const minted = await admin.post(`/api/instances/${instanceA.id}/tokens`, { scope: "read" });
  const revoked = await admin.delete(`/api/instances/${instanceA.id}/tokens/${minted.body.id}`);
  assert.equal(revoked.status, 204);
  const stillListed = await admin.get(`/api/instances/${instanceA.id}/tokens`);
  assert.ok(!stillListed.body.some((t: any) => t.id === minted.body.id));
});

after(() => server.close());
