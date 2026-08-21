import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startTestServer } from "../testing/harness.js";

const run = promisify(execFile);

// Real end-to-end coverage for CLI login parity: spawns the actual
// cli/bin/wharf.js binary as a child process against a real running control
// plane (not a mocked fetch), same "verify against the real thing" standard
// as everything else in this suite. WHARF_CONFIG_DIR is set to an isolated
// temp dir per test run so this never touches a real user's ~/.wharf.
const ADMIN_TOKEN = "cli-test-admin-secret";
const server = await startTestServer({ WHARF_TOKEN: ADMIN_TOKEN });
const cliBin = fileURLToPath(new URL("../../../cli/bin/wharf.js", import.meta.url));
const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "wharf-cli-config-"));

function cli(args: string[], env: Record<string, string | undefined> = {}) {
  return run(process.execPath, [cliBin, ...args], {
    env: {
      PATH: process.env.PATH,
      WHARF_API_URL: server.baseUrl,
      WHARF_CONFIG_DIR: configDir,
      ...env,
    },
  });
}

test("signup creates the superadmin account and stores a working session", async () => {
  const { stdout } = await cli(["signup"], { WHARF_EMAIL: "cli@example.com", WHARF_PASSWORD: "correct-horse-battery" });
  assert.match(stdout, /Account created — this is the superadmin account/);
  assert.match(stdout, /Signed in as cli@example\.com/);

  const sessionFile = JSON.parse(await fs.readFile(path.join(configDir, "sessions.json"), "utf8"));
  assert.equal(sessionFile[server.baseUrl].email, "cli@example.com");
  assert.match(sessionFile[server.baseUrl].cookie, /^wharf_session=/);

  const mode = (await fs.stat(path.join(configDir, "sessions.json"))).mode & 0o777;
  assert.equal(mode, 0o600, "the session file holds a live credential and must not be group/world readable");
});

test("whoami reports the signed-in account, including superadmin status", async () => {
  const { stdout } = await cli(["whoami"]);
  assert.match(stdout, /cli@example\.com \(superadmin\)/);
});

test("list works using the stored session, with no WHARF_TOKEN involved", async () => {
  const { stdout } = await cli(["list"]);
  assert.match(stdout, /No instances yet/);
});

test("a second signup is a regular, non-superadmin account", async () => {
  const { stdout } = await cli(["signup"], { WHARF_EMAIL: "cli-second@example.com", WHARF_PASSWORD: "correct-horse-battery" });
  assert.match(stdout, /Account created\. Signed in as cli-second@example\.com\./);
  assert.doesNotMatch(stdout, /superadmin/);
});

test("logout clears the session; a subsequent command fails with a helpful message", async () => {
  const loggedOut = await cli(["logout"]);
  assert.match(loggedOut.stdout, /Signed out\./);

  const sessionFile = JSON.parse(await fs.readFile(path.join(configDir, "sessions.json"), "utf8"));
  assert.equal(sessionFile[server.baseUrl], undefined);

  await assert.rejects(cli(["list"]), (err: any) => {
    assert.match(err.stderr, /run `wharf login` or set WHARF_TOKEN/);
    return true;
  });

  const whoami = await cli(["whoami"]);
  assert.match(whoami.stdout, /Not signed in/);
});

test("login re-authenticates an existing account by email/password", async () => {
  const { stdout } = await cli(["login"], { WHARF_EMAIL: "cli-second@example.com", WHARF_PASSWORD: "correct-horse-battery" });
  assert.match(stdout, /Signed in as cli-second@example\.com\./);

  const whoami = await cli(["whoami"]);
  assert.match(whoami.stdout, /cli-second@example\.com/);
  assert.doesNotMatch(whoami.stdout, /superadmin/);
});

test("login rejects the wrong password", async () => {
  await assert.rejects(cli(["login"], { WHARF_EMAIL: "cli-second@example.com", WHARF_PASSWORD: "totally-wrong" }));
});

test("whoami reports WHARF_TOKEN as the active credential without a session lookup", async () => {
  const { stdout } = await cli(["whoami"], { WHARF_TOKEN: ADMIN_TOKEN });
  assert.match(stdout, /Authenticated via WHARF_TOKEN/);
});

test("WHARF_TOKEN actually wins over a saved session, not just in whoami's messaging", async () => {
  // Corrupt the stored session's cookie directly. If the CLI fell back to
  // it despite WHARF_TOKEN being set, this would 401 — proving the request
  // really carried the token header, not just that whoami claims it would.
  const sessionPath = path.join(configDir, "sessions.json");
  const sessions = JSON.parse(await fs.readFile(sessionPath, "utf8"));
  sessions[server.baseUrl].cookie = "wharf_session=not-a-real-session-value";
  await fs.writeFile(sessionPath, JSON.stringify(sessions));

  const withToken = await cli(["list"], { WHARF_TOKEN: ADMIN_TOKEN });
  assert.match(withToken.stdout, /No instances yet/);

  // Without the token, that same now-broken session correctly fails.
  await assert.rejects(cli(["list"]));
});

after(async () => {
  await server.close();
  await fs.rm(configDir, { recursive: true, force: true });
});
