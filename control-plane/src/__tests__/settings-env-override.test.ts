import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A separate file (not settings.test.ts) on purpose: WHARF_PUBLIC_HOST is
// read into a module-level const at import time, so this file needs it set
// *before* settings.ts is ever imported in this process — settings.test.ts
// already imports it without the env var set, and env vars read once at
// import time can't be un-read within the same process afterward.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wharf-settings-env-test-"));
process.env.WHARF_DATA_DIR = dataDir;
process.env.WHARF_PUBLIC_HOST = "override.example.com";

const { publicHost, getDeploymentSettings, updateDeploymentSettings } = await import("../settings.js");

test("WHARF_PUBLIC_HOST is an absolute override, even after the DB-backed value is set", () => {
  assert.equal(publicHost(), "override.example.com");
  assert.equal(getDeploymentSettings().publicHostLockedByEnv, true);

  updateDeploymentSettings({ publicHost: "203.0.113.10", hostKind: "ip" });
  assert.equal(publicHost(), "override.example.com", "the env var must still win over whatever was just stored");
});
