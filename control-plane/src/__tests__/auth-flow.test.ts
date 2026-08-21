import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, Client } from "../testing/harness.js";

// No WHARF_TOKEN in this file's env — exercises the mandatory first-boot
// setup flow described in README.md and PLAN.md: no anonymous bootstrap
// window anymore, the very first account is forced through signup and
// automatically becomes superadmin.
const server = await startTestServer();
const c = new Client(server.baseUrl);

test("before any account exists, config reports needsSetup and unauthenticated requests are rejected", async () => {
  const config = await c.get("/api/config");
  assert.equal(config.body.needsSetup, true);

  const list = await c.get("/api/instances");
  assert.equal(list.status, 401, "there is no more anonymous full-access window");
});

test("signup requires a valid email and an 8+ character password", async () => {
  const badEmail = await c.post("/api/auth/signup", { email: "not-an-email", password: "longenough123" });
  assert.equal(badEmail.status, 400);

  const shortPassword = await c.post("/api/auth/signup", { email: "a@example.com", password: "short" });
  assert.equal(shortPassword.status, 400);
});

test("signup creates an account, signs them in, and the first account becomes superadmin", async () => {
  const signup = await c.post("/api/auth/signup", { email: "Alice@Example.com", password: "correct-horse-battery" });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.email, "alice@example.com"); // normalized to lowercase
  assert.equal(signup.body.isSuperadmin, true, "the very first account on a fresh instance is always superadmin");

  const config = await c.get("/api/config");
  assert.equal(config.body.needsSetup, false);
});

test("a second signup creates a regular, non-superadmin account", async () => {
  const signup = await new Client(server.baseUrl).post("/api/auth/signup", { email: "bob@example.com", password: "correct-horse-battery" });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.isSuperadmin, false);

  const config = await c.get("/api/config");
  assert.equal(config.body.needsSetup, false, "still false — only the very first account matters");
});

test("after the first account, an unauthenticated client is rejected", async () => {
  const anon = new Client(server.baseUrl);
  const res = await anon.get("/api/instances");
  assert.equal(res.status, 401);
});

test("duplicate signup email is rejected", async () => {
  const res = await c.post("/api/auth/signup", { email: "alice@example.com", password: "another-long-one" });
  assert.equal(res.status, 409);
});

test("login rejects a wrong password and accepts the right one", async () => {
  const wrong = await new Client(server.baseUrl).post("/api/auth/login", { email: "alice@example.com", password: "wrong-password" });
  assert.equal(wrong.status, 401);

  const right = new Client(server.baseUrl);
  const ok = await right.post("/api/auth/login", { email: "alice@example.com", password: "correct-horse-battery" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.email, "alice@example.com");

  const me = await right.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.email, "alice@example.com");
});

test("settings: PATCH /api/auth/me updates the default model", async () => {
  const session = new Client(server.baseUrl);
  await session.post("/api/auth/login", { email: "alice@example.com", password: "correct-horse-battery" });

  const patched = await session.patch("/api/auth/me", { defaultModel: "anthropic/claude-sonnet-5" });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.defaultModel, "anthropic/claude-sonnet-5");

  const me = await session.get("/api/auth/me");
  assert.equal(me.body.defaultModel, "anthropic/claude-sonnet-5");
});

test("logout clears the session — a subsequent /auth/me is unauthenticated", async () => {
  const session = new Client(server.baseUrl);
  await session.post("/api/auth/login", { email: "alice@example.com", password: "correct-horse-battery" });
  assert.equal((await session.get("/api/auth/me")).status, 200);

  const out = await session.post("/api/auth/logout");
  assert.equal(out.status, 204);

  const me = await session.get("/api/auth/me");
  assert.equal(me.status, 401);
});

after(() => server.close());
