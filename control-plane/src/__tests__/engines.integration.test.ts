import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, Client, dockerAvailable } from "../testing/harness.js";
import { runDueBackups } from "../backups.js";
import { instancesRepo } from "../db.js";

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

test("postgres: create, connect, browse, query, backup", { skip, timeout: 240_000 }, async () => {
  const instance = await createAndWait("postgres");
  assert.ok(instance.connection?.connectionString.startsWith("postgres://"));

  // Sample data (seedSampleData) is inserted before the instance is marked
  // running, so a fresh instance already has something to look at.
  const objects = await client.get(`/api/instances/${instance.id}/browse/objects`);
  assert.equal(objects.status, 200);
  assert.deepEqual(
    objects.body.map((o: any) => o.name).sort(),
    ["customers", "orders"]
  );

  const seeded = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SELECT count(*) AS n FROM customers" });
  assert.equal(seeded.status, 200);
  assert.equal(Number(seeded.body.rows[0].n), 3);

  // CSV import into the seeded table — the columns come straight from the
  // CSV header, so id/created_at are correctly left out (SERIAL + DEFAULT).
  const imported = await client.post(`/api/instances/${instance.id}/browse/import`, {
    format: "csv",
    target: "customers",
    data: "name,email\nImported User,imported@example.com",
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.inserted, 1);
  const afterImport = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SELECT count(*) AS n FROM customers" });
  assert.equal(Number(afterImport.body.rows[0].n), 4);

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

  // Scheduled backups, against a real container: enabling a schedule makes
  // it immediately "due" (no prior run), so calling runDueBackups directly
  // (bypassing the real interval timer, which only starts from index.ts —
  // see its comment) must produce one new backup right away, and a second
  // call right after must not produce another, since it isn't due yet.
  const scheduled = await client.patch(`/api/instances/${instance.id}/backup-schedule`, { intervalHours: 1, retentionCount: 5 });
  assert.equal(scheduled.status, 200);
  assert.equal(scheduled.body.lastRunAt, null);
  const beforeCount = (await client.get(`/api/instances/${instance.id}/backups`)).body.length;
  await runDueBackups((id) => instancesRepo.get(id));
  const afterFirstRun = await client.get(`/api/instances/${instance.id}/backups`);
  assert.equal(afterFirstRun.body.length, beforeCount + 1, "the due schedule should have created exactly one new backup");
  await runDueBackups((id) => instancesRepo.get(id));
  const afterSecondRun = await client.get(`/api/instances/${instance.id}/backups`);
  assert.equal(afterSecondRun.body.length, afterFirstRun.body.length, "not due yet — a second run right away shouldn't create another");

  // Branching: the whole point is a real, independent copy — not a proxy or
  // a reference. Branch from the current state (4 customers, post-import),
  // then mutate the source only and confirm the branch doesn't see it.
  const branched = await client.post(`/api/instances/${instance.id}/branches`, {});
  assert.equal(branched.status, 201, `branch should return 201 (got ${branched.status}: ${JSON.stringify(branched.body)})`);
  assert.equal(branched.body.status, "running");
  assert.ok(branched.body.connection?.connectionString.startsWith("postgres://"));

  const branchCount = await client.post(`/api/instances/${branched.body.id}/browse/query`, { query: "SELECT count(*) AS n FROM customers" });
  assert.equal(Number(branchCount.body.rows[0].n), 4, "the branch should start with exactly the source's data at branch time");

  await client.post(`/api/instances/${instance.id}/browse/query`, {
    query: "INSERT INTO customers (name, email) VALUES ('Source Only', 'source-only@example.com')",
  });
  const sourceAfter = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SELECT count(*) AS n FROM customers" });
  assert.equal(Number(sourceAfter.body.rows[0].n), 5, "the source should reflect its own new row");
  const branchAfter = await client.post(`/api/instances/${branched.body.id}/browse/query`, { query: "SELECT count(*) AS n FROM customers" });
  assert.equal(Number(branchAfter.body.rows[0].n), 4, "the branch must not see a row inserted into the source after branching — it's a real copy, not a proxy");

  await client.delete(`/api/instances/${branched.body.id}`);

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
  assert.deepEqual(
    objects.body.map((o: any) => o.name).sort(),
    ["customers", "orders"]
  );

  const seeded = await client.post(`/api/instances/${instance.id}/browse/query`, {
    query: JSON.stringify({ collection: "customers", filter: {} }),
  });
  assert.equal(seeded.status, 200);
  assert.equal(seeded.body.rows.length, 3);

  const imported = await client.post(`/api/instances/${instance.id}/browse/import`, {
    format: "json",
    target: "customers",
    data: JSON.stringify([{ name: "Imported User", email: "imported@example.com" }]),
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.inserted, 1);
  const afterImport = await client.post(`/api/instances/${instance.id}/browse/query`, {
    query: JSON.stringify({ collection: "customers", filter: {} }),
  });
  assert.equal(afterImport.body.rows.length, 4);

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

  // JSON import — {key, value} pairs, since redis has no table/collection concept.
  const imported = await client.post(`/api/instances/${instance.id}/browse/import`, {
    format: "json",
    data: JSON.stringify([{ key: "imported:test", value: "hello-import" }]),
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.inserted, 1);
  const importedGet = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "GET imported:test" });
  assert.equal(importedGet.body.rows[0], "hello-import");

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

  const imported = await client.post(`/api/instances/${instance.id}/browse/import`, {
    format: "json",
    target: "events",
    data: JSON.stringify([{ id: 2, name: "second" }]),
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.inserted, 1);
  const afterImport = await client.post(`/api/instances/${instance.id}/browse/query`, { query: "SELECT count(*) AS n FROM events" });
  assert.equal(Number(afterImport.body.rows[0].n), 2);

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
