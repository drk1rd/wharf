import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, setupSuperadmin } from "../testing/harness.js";

// Route-level validation only — actually filtering real rows needs a real
// container, covered for real in engines.integration.test.ts. What's
// testable here without Docker: malformed/invalid-shaped `filters` query
// params get a clean 400 before ever reaching the adapter, and an invalid
// filter operator (or column identifier) is rejected by the adapter's own
// buildWhere()/quoteIdent() synchronously, before any network call — same
// reasoning as browser-safety.test.ts pinning down quoteIdent directly.
const server = await startTestServer();
const { instancesRepo } = await import("../db.js");
const client = await setupSuperadmin(server);

const row = {
  id: randomUUID(),
  owner_id: null,
  name: "filter-test",
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

function rowsUrl(filters: string) {
  return `/api/instances/${row.id}/browse/objects/customers/rows?filters=${encodeURIComponent(filters)}`;
}

test("malformed filters JSON is rejected before touching the container", async () => {
  const res = await client.get(rowsUrl("not json"));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /valid JSON/);
});

test("filters that aren't an array of {column, op, value} are rejected", async () => {
  const notArray = await client.get(rowsUrl(JSON.stringify({ column: "a", op: "=", value: "b" })));
  assert.equal(notArray.status, 400);

  const badShape = await client.get(rowsUrl(JSON.stringify([{ column: "a" }])));
  assert.equal(badShape.status, 400);

  const badOp = await client.get(rowsUrl(JSON.stringify([{ column: "a", op: "DROP", value: "b" }])));
  assert.equal(badOp.status, 400);
});

test("a well-formed filter passes validation and actually reaches the adapter", async () => {
  const res = await client.get(rowsUrl(JSON.stringify([{ column: "email", op: "contains", value: "ok" }])));
  // Not a 400 — it got past every validation layer and failed instead on
  // the (fake, unreachable) container, proving a valid filter isn't
  // wrongly rejected.
  assert.notEqual(res.status, 400);
});

test("an invalid identifier in a filter column is rejected before any network call", async () => {
  const res = await client.get(rowsUrl(JSON.stringify([{ column: `email"; DROP TABLE customers; --`, op: "=", value: "x" }])));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /invalid identifier/);
});

after(() => server.close());
