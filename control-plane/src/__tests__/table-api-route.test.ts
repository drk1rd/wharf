import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, Client, setupSuperadmin } from "../testing/harness.js";

// Docker-free by design, same reasoning as import-route.test.ts and
// scoped-tokens.test.ts: the engine-allowlist check and requireWriteAccess
// both short-circuit before tableFor() ever calls adapter.listObjects()
// (the one place this route touches a real container) — a real end-to-end
// CRUD round-trip against a live postgres container is covered separately
// in engines.integration.test.ts.
const server = await startTestServer();
const { instancesRepo } = await import("../db.js");
const admin = await setupSuperadmin(server);

function fakeInstance(engine: string) {
  const row = {
    id: randomUUID(),
    owner_id: null,
    name: `table-api-${engine}`,
    engine,
    version: "1",
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
    tls_enabled: 0,
  };
  instancesRepo.insert(row);
  return row;
}

const mongo = fakeInstance("mongodb");
const redis = fakeInstance("redis");
const postgres = fakeInstance("postgres");

test("the table API is refused for engines without tables", async () => {
  for (const row of [mongo, redis]) {
    const list = await admin.get(`/api/instances/${row.id}/api/customers`);
    assert.equal(list.status, 400);
    assert.match(list.body.error, /only supports SQL engines/);

    const one = await admin.get(`/api/instances/${row.id}/api/customers/1`);
    assert.equal(one.status, 400);

    const created = await admin.post(`/api/instances/${row.id}/api/customers`, { name: "x" });
    assert.equal(created.status, 400);

    const updated = await admin.patch(`/api/instances/${row.id}/api/customers/1`, { name: "y" });
    assert.equal(updated.status, 400);

    const deleted = await admin.delete(`/api/instances/${row.id}/api/customers/1`);
    assert.equal(deleted.status, 400);
  }
});

test("a read-scoped token is rejected from every mutating table-API route before touching the container", async () => {
  const minted = await admin.post(`/api/instances/${postgres.id}/tokens`, { scope: "read" });
  const reader = new Client(server.baseUrl, { token: minted.body.token });

  for (const attempt of [
    () => reader.post(`/api/instances/${postgres.id}/api/customers`, { name: "x" }),
    () => reader.patch(`/api/instances/${postgres.id}/api/customers/1`, { name: "y" }),
    () => reader.delete(`/api/instances/${postgres.id}/api/customers/1`),
  ]) {
    const res = await attempt();
    assert.equal(res.status, 403, `expected a read-only token to be rejected: ${JSON.stringify(res.body)}`);
  }
});

test("GET routes are not blocked by the write-access gate for a read-scoped token", async () => {
  const minted = await admin.post(`/api/instances/${postgres.id}/tokens`, { scope: "read" });
  const reader = new Client(server.baseUrl, { token: minted.body.token });

  const list = await reader.get(`/api/instances/${postgres.id}/api/customers`);
  assert.notEqual(list.status, 403);
  const one = await reader.get(`/api/instances/${postgres.id}/api/customers/1`);
  assert.notEqual(one.status, 403);
});

after(() => server.close());
