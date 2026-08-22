import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, setupSuperadmin } from "../testing/harness.js";

// Route-level input validation only — reaching the real import path needs a
// real running container, already covered for real by the Docker-gated
// tests in engines.integration.test.ts. This checks the request gets
// rejected with a clear error before it ever tries to touch the (fake,
// unreachable) instance, same bypass-Docker pattern as ownership.test.ts.
const server = await startTestServer();
const { instancesRepo } = await import("../db.js");
const client = await setupSuperadmin(server);

const row = {
  id: randomUUID(),
  owner_id: null,
  name: "import-test",
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
  tls_enabled: 0,
};
instancesRepo.insert(row);

test("import rejects a request with no data", async () => {
  const res = await client.post(`/api/instances/${row.id}/browse/import`, { format: "csv", target: "customers" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /data is required/);
});

test("import rejects an unrecognized format", async () => {
  const res = await client.post(`/api/instances/${row.id}/browse/import`, { format: "xml", target: "customers", data: "<a/>" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /format must be/);
});

test("import rejects a missing target for a SQL engine", async () => {
  const res = await client.post(`/api/instances/${row.id}/browse/import`, { format: "csv", data: "a,b\n1,2" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /target/);
});

test("import rejects malformed JSON", async () => {
  const res = await client.post(`/api/instances/${row.id}/browse/import`, { format: "json", target: "customers", data: "not json" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /invalid JSON/);
});

after(() => server.close());
