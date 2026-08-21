import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, Client, setupSuperadmin } from "../testing/harness.js";

// This is the actual security boundary the multi-user account system exists
// to enforce: one user must never see, browse, or delete another user's
// database. Instance rows are inserted directly via the repo (bypassing
// Docker entirely) so this test is fast, deterministic, and runs everywhere —
// it's testing the authorization logic, not container provisioning.
const server = await startTestServer();
const { instancesRepo } = await import("../db.js");

function fakeInstance(ownerId: string | null, name: string) {
  const row = {
    id: randomUUID(),
    owner_id: ownerId,
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

// Consumes the "first account becomes superadmin" slot so alice/bob below
// are both regular users — a superadmin can see every instance by design
// (routes/instances.ts), which would otherwise silently defeat the very
// ownership boundary these tests exist to prove.
await setupSuperadmin(server);

const alice = new Client(server.baseUrl);
const bob = new Client(server.baseUrl);

await alice.post("/api/auth/signup", { email: "alice@example.com", password: "correct-horse-battery" });
await bob.post("/api/auth/signup", { email: "bob@example.com", password: "correct-horse-battery" });

const aliceId = (await alice.get("/api/auth/me")).body.id as string;
const bobId = (await bob.get("/api/auth/me")).body.id as string;

const aliceInstance = fakeInstance(aliceId, "alice-db");
const bobInstance = fakeInstance(bobId, "bob-db");
const sharedInstance = fakeInstance(null, "shared-db");

test("a user's instance list includes only their own instances plus ownerless ones", async () => {
  const res = await alice.get("/api/instances");
  const names = res.body.map((r: any) => r.name).sort();
  assert.deepEqual(names, ["alice-db", "shared-db"]);
});

test("a user can fetch their own instance directly", async () => {
  const res = await alice.get(`/api/instances/${aliceInstance.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.name, "alice-db");
});

test("a user can fetch an ownerless (shared) instance", async () => {
  const res = await bob.get(`/api/instances/${sharedInstance.id}`);
  assert.equal(res.status, 200);
});

test("a user cannot fetch another user's instance — 404, not 403 (existence isn't leaked)", async () => {
  const res = await alice.get(`/api/instances/${bobInstance.id}`);
  assert.equal(res.status, 404);
});

test("a user cannot delete another user's instance, and it isn't touched", async () => {
  const res = await alice.delete(`/api/instances/${bobInstance.id}`);
  assert.equal(res.status, 404);

  const stillThere = instancesRepo.get(bobInstance.id);
  assert.ok(stillThere, "bob's instance must still exist after alice's failed delete attempt");
});

test("a user cannot browse or query another user's instance", async () => {
  const objects = await alice.get(`/api/instances/${bobInstance.id}/browse/objects`);
  assert.equal(objects.status, 404);

  const query = await alice.post(`/api/instances/${bobInstance.id}/browse/query`, { query: "select 1" });
  assert.equal(query.status, 404);
});

after(() => server.close());
