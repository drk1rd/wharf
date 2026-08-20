import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, Client, dockerAvailable } from "../testing/harness.js";

// These are the only tests in the suite that touch a real Docker daemon and
// pull real images. They're written to run for real in CI (GitHub-hosted
// runners have both a working daemon and unrestricted internet) rather than
// in a locked-down sandbox — this environment's own network policy has
// blocked every Docker Hub pull attempted all session, which is exactly the
// gap this file exists to close once it runs somewhere that isn't blocked.
const available = await dockerAvailable();
const skip = available ? false : "no reachable Docker daemon — this is expected in network-restricted sandboxes, not in CI";

const server = await startTestServer();
const client = new Client(server.baseUrl);

async function waitForStatus(id: string, timeoutMs = 120_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.get(`/api/instances/${id}`);
    if (res.body.status === "running" || res.body.status === "error") return res.body;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`instance ${id} did not settle within ${timeoutMs}ms`);
}

async function createAndWait(engine: string) {
  const created = await client.post("/api/instances", { engine });
  assert.equal(created.status, 201, `create ${engine} should return 201`);
  const settled = await waitForStatus(created.body.id);
  assert.equal(settled.status, "running", `${engine} instance should reach running (got: ${settled.status}, error: ${settled.error})`);
  return settled;
}

test("postgres: create, connect, browse, query, backup", { skip, timeout: 150_000 }, async () => {
  const instance = await createAndWait("postgres");
  assert.ok(instance.connection?.connectionString.startsWith("postgres://"));

  const objects = await client.get(`/api/instances/${instance.id}/browse/objects`);
  assert.equal(objects.status, 200);
  assert.deepEqual(objects.body, []);

  const query = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SELECT 1 AS one" });
  assert.equal(query.status, 200);
  assert.equal(query.body.rows[0].one, 1);

  const backup = await client.post(`/api/instances/${instance.id}/backups`);
  assert.equal(backup.status, 201);
  assert.ok(backup.body.size_bytes > 0);

  const del = await client.delete(`/api/instances/${instance.id}`);
  assert.equal(del.status, 204);
});

test("mysql: create, connect, browse, query, backup", { skip, timeout: 150_000 }, async () => {
  const instance = await createAndWait("mysql");
  assert.ok(instance.connection?.connectionString.startsWith("mysql://"));

  const query = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SELECT 1 AS one" });
  assert.equal(query.status, 200);
  assert.equal(Number(query.body.rows[0].one), 1);

  const backup = await client.post(`/api/instances/${instance.id}/backups`);
  assert.equal(backup.status, 201);

  await client.delete(`/api/instances/${instance.id}`);
});

test("mongodb: create, connect, browse, query, backup", { skip, timeout: 150_000 }, async () => {
  const instance = await createAndWait("mongodb");
  assert.ok(instance.connection?.connectionString.startsWith("mongodb://"));

  const objects = await client.get(`/api/instances/${instance.id}/browse/objects`);
  assert.equal(objects.status, 200);
  assert.deepEqual(objects.body, []);

  const query = await client.post(`/api/instances/${instance.id}/browse/query`, {
    query: JSON.stringify({ collection: "nonexistent", filter: {} }),
  });
  assert.equal(query.status, 200);
  assert.deepEqual(query.body.rows, []);

  const backup = await client.post(`/api/instances/${instance.id}/backups`);
  assert.equal(backup.status, 201);

  await client.delete(`/api/instances/${instance.id}`);
});

test("redis: create, connect, run commands, no backup support", { skip, timeout: 150_000 }, async () => {
  const instance = await createAndWait("redis");
  assert.ok(instance.connection?.connectionString.startsWith("redis://"));
  assert.equal(instance.backupSupported, false);

  const set = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SET testkey hello" });
  assert.equal(set.status, 200);

  const get = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "GET testkey" });
  assert.equal(get.status, 200);
  assert.equal(get.body.rows[0], "hello");

  const backup = await client.post(`/api/instances/${instance.id}/backups`);
  assert.equal(backup.status, 400);

  await client.delete(`/api/instances/${instance.id}`);
});

after(() => server.close());
