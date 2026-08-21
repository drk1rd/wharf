import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, Client, setupSuperadmin } from "../testing/harness.js";

// Route-level checks only — actually cloning data needs a real container
// (createBackup's exec-based dump has no docker-less fallback), so the real
// end-to-end branch is exercised for real in engines.integration.test.ts.
// These two checks both short-circuit before ever touching Docker: the
// scoped-token rejection happens in the route handler itself, and a bad
// source id 404s inside requireRunningInstance before createBackup runs.
const server = await startTestServer();
const { instancesRepo } = await import("../db.js");
const admin = await setupSuperadmin(server);

test("a scoped token cannot create a branch", async () => {
  const row = {
    id: randomUUID(),
    owner_id: null,
    name: "branch-source",
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

  const minted = await admin.post(`/api/instances/${row.id}/tokens`, { scope: "write" });
  const scoped = new Client(server.baseUrl, { token: minted.body.token });
  const res = await scoped.post(`/api/instances/${row.id}/branches`, {});
  assert.equal(res.status, 403);
});

test("branching a nonexistent instance 404s", async () => {
  const res = await admin.post(`/api/instances/does-not-exist/branches`, {});
  assert.equal(res.status, 404);
});

after(() => server.close());
