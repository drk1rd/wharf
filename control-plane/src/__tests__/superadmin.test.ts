import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, Client, setupSuperadmin } from "../testing/harness.js";

// Covers the "must have all management for everything" surface added on
// top of the account system: the first account's automatic promotion,
// canAccessInstance treating a superadmin like the WHARF_TOKEN admin
// credential, and the platform-wide user-management routes
// (routes/admin.ts) — list/promote/demote/delete, with WHARF_TOKEN set
// too so the "can't remove the last remaining superadmin" guard can be
// exercised by an actor other than the sole superadmin themselves.
const ADMIN_TOKEN = "admin-secret-for-superadmin-test";
const server = await startTestServer({ WHARF_TOKEN: ADMIN_TOKEN });
const { instancesRepo } = await import("../db.js");
const adminToken = new Client(server.baseUrl, { token: ADMIN_TOKEN });

const superadmin = await setupSuperadmin(server, "root@example.com", "correct-horse-battery");
const superadminId = (await superadmin.get("/api/auth/me")).body.id as string;

const userA = new Client(server.baseUrl);
await userA.post("/api/auth/signup", { email: "usera@example.com", password: "correct-horse-battery" });
const userAId = (await userA.get("/api/auth/me")).body.id as string;

const userB = new Client(server.baseUrl);
await userB.post("/api/auth/signup", { email: "userb@example.com", password: "correct-horse-battery" });
const userBId = (await userB.get("/api/auth/me")).body.id as string;

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

test("a superadmin sees every instance, not just their own", async () => {
  const aInstance = fakeInstance(userAId, "a-db");
  const bInstance = fakeInstance(userBId, "b-db");

  const res = await superadmin.get("/api/instances");
  const names = res.body.map((r: any) => r.name);
  assert.ok(names.includes("a-db") && names.includes("b-db"));

  // A regular user still only sees their own + ownerless, unaffected.
  const asA = await userA.get("/api/instances");
  assert.ok(!asA.body.some((r: any) => r.id === bInstance.id));
  assert.ok(asA.body.some((r: any) => r.id === aInstance.id));
});

test("a regular user cannot list, promote, or delete other accounts", async () => {
  assert.equal((await userA.get("/api/users")).status, 403);
  assert.equal((await userA.patch(`/api/users/${userBId}`, { isSuperadmin: true })).status, 403);
  assert.equal((await userA.delete(`/api/users/${userBId}`)).status, 403);
});

test("a superadmin can list every account", async () => {
  const res = await superadmin.get("/api/users");
  assert.equal(res.status, 200);
  const byEmail = Object.fromEntries(res.body.map((u: any) => [u.email, u]));
  assert.equal(byEmail["root@example.com"].isSuperadmin, true);
  assert.equal(byEmail["usera@example.com"].isSuperadmin, false);
  assert.equal(byEmail["userb@example.com"].isSuperadmin, false);
});

test("a superadmin cannot change their own superadmin status or delete their own account", async () => {
  const demoteSelf = await superadmin.patch(`/api/users/${superadminId}`, { isSuperadmin: false });
  assert.equal(demoteSelf.status, 400);

  const deleteSelf = await superadmin.delete(`/api/users/${superadminId}`);
  assert.equal(deleteSelf.status, 400);
});

test("promoting a user takes effect on their very next request, no re-login needed", async () => {
  const promote = await superadmin.patch(`/api/users/${userAId}`, { isSuperadmin: true });
  assert.equal(promote.status, 200);
  assert.equal(promote.body.isSuperadmin, true);

  // userA's session cookie was minted before this promotion — proving the
  // NEXT request already sees the new status (not just a fresh login).
  const asPromotedA = await userA.get("/api/users");
  assert.equal(asPromotedA.status, 200);
});

test("can't remove the last remaining superadmin", async () => {
  // Bring it back down to exactly one superadmin first.
  const demoteA = await superadmin.patch(`/api/users/${userAId}`, { isSuperadmin: false });
  assert.equal(demoteA.status, 200);

  // The WHARF_TOKEN admin credential isn't "self" from the server's point
  // of view, so this reaches the last-superadmin guard rather than the
  // self-modification one.
  const res = await adminToken.patch(`/api/users/${superadminId}`, { isSuperadmin: false });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /last remaining superadmin/);
});

test("deleting a user reassigns their instances to ownerless and signs them out, rather than deleting the databases", async () => {
  const instance = fakeInstance(userBId, "userb-owned-db");

  const del = await superadmin.delete(`/api/users/${userBId}`);
  assert.equal(del.status, 204);

  const reassigned = instancesRepo.get(instance.id);
  assert.equal(reassigned?.owner_id, null, "the instance survives, now ownerless");

  const stillLoggedIn = await userB.get("/api/auth/me");
  assert.equal(stillLoggedIn.status, 401, "the deleted user's session must be invalidated");
});

test("deleting a nonexistent user 404s", async () => {
  const res = await superadmin.delete(`/api/users/does-not-exist`);
  assert.equal(res.status, 404);
});

after(() => server.close());
