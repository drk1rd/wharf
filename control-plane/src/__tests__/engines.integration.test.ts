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

  // Live resize — no restart, checked here since it applies to any running
  // engine and postgres is as good a place as any to prove it end to end.
  const resized = await client.patch(`/api/instances/${instance.id}/resize`, { cpu: "0.5", memoryMb: 256 });
  assert.equal(resized.status, 200);
  assert.equal(resized.body.resources.cpu, "0.5");
  assert.equal(resized.body.resources.memoryMb, 256);
  // The instance must still actually work after a live resize, not just report new numbers.
  const afterResize = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SELECT 2 AS two" });
  assert.equal(afterResize.status, 200);
  assert.equal(afterResize.body.rows[0].two, 2);

  const backup = await client.post(`/api/instances/${instance.id}/backups`);
  assert.equal(backup.status, 201);
  assert.ok(backup.body.size_bytes > 0);

  const del = await client.delete(`/api/instances/${instance.id}`);
  assert.equal(del.status, 204, `delete should return 204 (got ${del.status}: ${JSON.stringify(del.body)})`);
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

test("redis: create, connect, run commands, backup and restore round-trip", { skip, timeout: 150_000 }, async () => {
  const instance = await createAndWait("redis");
  assert.ok(instance.connection?.connectionString.startsWith("redis://"));
  assert.equal(instance.backupSupported, true);

  const set = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SET testkey hello" });
  assert.equal(set.status, 200);

  const get = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "GET testkey" });
  assert.equal(get.status, 200);
  assert.equal(get.body.rows[0], "hello");

  const backup = await client.post(`/api/instances/${instance.id}/backups`);
  assert.equal(backup.status, 201);
  assert.ok(backup.body.size_bytes > 0);

  // Prove restore actually replaces state, not just "runs without erroring":
  // overwrite the key, restore the backup taken before that, confirm the
  // original value is back — a round trip through real DUMP/RESTORE bytes.
  await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SET testkey overwritten" });
  const restore = await client.post(`/api/instances/${instance.id}/restore`, { backupId: backup.body.id });
  assert.equal(restore.status, 204);

  const afterRestore = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "GET testkey" });
  assert.equal(afterRestore.body.rows[0], "hello");

  await client.delete(`/api/instances/${instance.id}`);
});

test("clickhouse: create, connect, browse, query, backup and restore round-trip", { skip, timeout: 150_000 }, async () => {
  const instance = await createAndWait("clickhouse");
  assert.ok(instance.connection?.connectionString.startsWith("http://"));
  assert.equal(instance.backupSupported, true);

  await client.post(`/api/instances/${instance.id}/browse/query`, {
    query: "CREATE TABLE events (id UInt32, name String) ENGINE = MergeTree ORDER BY id",
  });
  await client.post(`/api/instances/${instance.id}/browse/query`, {
    query: "INSERT INTO events (id, name) VALUES (1, 'first')",
  });

  const objects = await client.get(`/api/instances/${instance.id}/browse/objects`);
  assert.equal(objects.status, 200);
  assert.ok(objects.body.some((o: any) => o.name === "events"));

  const select = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SELECT * FROM events" });
  assert.equal(select.status, 200);
  assert.equal(select.body.rows[0].name, "first");

  const backup = await client.post(`/api/instances/${instance.id}/backups`);
  assert.equal(backup.status, 201);
  assert.ok(backup.body.size_bytes > 0);

  // The real "recover from data loss" scenario: the table itself is gone, not
  // just its rows. Restore has to recreate it from the captured DDL, not only
  // replay INSERTs into a table that's assumed to still exist.
  await client.post(`/api/instances/${instance.id}/browse/query`, { query: "DROP TABLE events" });
  const restore = await client.post(`/api/instances/${instance.id}/restore`, { backupId: backup.body.id });
  assert.equal(restore.status, 204);

  const afterRestore = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SELECT * FROM events" });
  assert.equal(afterRestore.status, 200);
  assert.equal(afterRestore.body.rows[0].name, "first");

  await client.delete(`/api/instances/${instance.id}`);
});

after(() => server.close());
