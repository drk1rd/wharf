import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, Client } from "../testing/harness.js";

// WHARF_TOKEN set from process start — this is the CLI's auth path. It's
// independent of account setup: needsSetup still reflects "no account
// exists yet" (WHARF_TOKEN doesn't create one), but every request below
// still needs real credentials regardless — there's no bootstrap window
// where an unauthenticated request succeeds, with or without the token set.
const server = await startTestServer({ WHARF_TOKEN: "test-admin-secret" });

test("with WHARF_TOKEN configured but no account created yet, config still reports needsSetup", async () => {
  const config = await new Client(server.baseUrl).get("/api/config");
  assert.equal(config.body.needsSetup, true);
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
