import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, Client } from "../testing/harness.js";

// No WHARF_TOKEN in this file's env — exercises the bootstrap/anonymous
// window described in README.md and PLAN.md §17 ("signing up the first
// account *is* the switch").
const server = await startTestServer();
const c = new Client(server.baseUrl);

test("bootstrap mode: unauthenticated requests work before any account exists", async () => {
  const config = await c.get("/api/config");
  assert.equal(config.body.authRequired, false);

  const list = await c.get("/api/instances");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, []);
});

test("signup requires a valid email and an 8+ character password", async () => {
  const badEmail = await c.post("/api/auth/signup", { email: "not-an-email", password: "longenough123" });
  assert.equal(badEmail.status, 400);

  const shortPassword = await c.post("/api/auth/signup", { email: "a@example.com", password: "short" });
  assert.equal(shortPassword.status, 400);
});

test("signup creates an account, signs them in, and flips authRequired on", async () => {
  const signup = await c.post("/api/auth/signup", { email: "Alice@Example.com", password: "correct-horse-battery" });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.email, "alice@example.com"); // normalized to lowercase

  const config = await c.get("/api/config");
  assert.equal(config.body.authRequired, true);
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
