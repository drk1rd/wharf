import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, Client } from "../testing/harness.js";

// A dedicated file, not a case inside scoped-tokens.test.ts: this uses the
// WHARF_TOKEN admin credential directly rather than a superadmin session, to
// keep the revocation proof independent of the account/session machinery
// entirely. Env vars for a test file are fixed at import time (see
// harness.ts's own comment), so this needs its own process rather than
// sharing scoped-tokens.test.ts's server.
const ADMIN_TOKEN = "admin-secret-for-revocation-test";
const server = await startTestServer({ WHARF_TOKEN: ADMIN_TOKEN });
const { instancesRepo } = await import("../db.js");
const admin = new Client(server.baseUrl, { token: ADMIN_TOKEN });

const instance = (() => {
  const row = {
    id: randomUUID(),
    owner_id: null,
    name: "revocation-test",
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
})();

test("a scoped token authenticates before revocation and is rejected after", async () => {
  const minted = await admin.post(`/api/instances/${instance.id}/tokens`, { scope: "read" });
  assert.equal(minted.status, 201);
  const client = new Client(server.baseUrl, { token: minted.body.token });

  const before = await client.get(`/api/instances/${instance.id}`);
  assert.equal(before.status, 200);

  const revoked = await admin.delete(`/api/instances/${instance.id}/tokens/${minted.body.id}`);
  assert.equal(revoked.status, 204);

  // With WHARF_TOKEN set and no session cookie, an unrecognized token means
  // req.auth is never set at all — requireAuth rejects with 401.
  const after = await client.get(`/api/instances/${instance.id}`);
  assert.equal(after.status, 401);
});

after(() => server.close());
