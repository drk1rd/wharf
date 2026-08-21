import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, Client } from "../testing/harness.js";

// WHARF_TOKEN set from process start — this is the CLI's auth path, and it
// also means the bootstrap/anonymous window from auth-flow.test.ts never
// opens, even with zero accounts.
const server = await startTestServer({ WHARF_TOKEN: "test-admin-secret" });

test("with WHARF_TOKEN configured, auth is required immediately — no anonymous bootstrap window", async () => {
  const config = await new Client(server.baseUrl).get("/api/config");
  assert.equal(config.body.authRequired, true);
});

test("a request with no credentials at all is rejected", async () => {
  const res = await new Client(server.baseUrl).get("/api/instances");
  assert.equal(res.status, 401);
});

test("the wrong token is rejected", async () => {
  const res = await new Client(server.baseUrl, { token: "not-the-real-token" }).get("/api/instances");
  assert.equal(res.status, 401);
});

test("the correct x-wharf-token grants access with no session/login needed", async () => {
  const res = await new Client(server.baseUrl, { token: "test-admin-secret" }).get("/api/instances");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

after(() => server.close());
