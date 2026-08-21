import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// settings.ts imports db.ts, which reads WHARF_DATA_DIR at module load —
// same dynamic-import-after-env-set reasoning as every other test file here.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wharf-settings-test-"));
process.env.WHARF_DATA_DIR = dataDir;
delete process.env.WHARF_PUBLIC_HOST;
delete process.env.WHARF_PROBE_HOST;

const { publicHost, probeHost, defaultTlsEnabled, getDeploymentSettings, updateDeploymentSettings } = await import("../settings.js");

test("defaults before the setup wizard ever runs", () => {
  assert.equal(publicHost(), "localhost");
  assert.equal(probeHost(), "localhost");
  assert.equal(defaultTlsEnabled(), false);
  const settings = getDeploymentSettings();
  assert.equal(settings.publicHost, null);
  assert.equal(settings.hostKind, "ip");
  assert.equal(settings.defaultTls, false);
  assert.equal(settings.publicHostLockedByEnv, false);
});

test("updateDeploymentSettings persists and is read back immediately (call-time, not frozen)", () => {
  const updated = updateDeploymentSettings({ publicHost: "203.0.113.10", hostKind: "ip", defaultTls: true });
  assert.equal(updated.publicHost, "203.0.113.10");
  assert.equal(updated.defaultTls, true);
  assert.equal(publicHost(), "203.0.113.10");
  assert.equal(defaultTlsEnabled(), true);
});

test("rejects an invalid IP when hostKind is ip", () => {
  assert.throws(() => updateDeploymentSettings({ publicHost: "not-an-ip", hostKind: "ip" }), /valid IPv4/);
});

test("rejects an invalid domain when hostKind is domain", () => {
  assert.throws(() => updateDeploymentSettings({ publicHost: "not a domain!", hostKind: "domain" }), /valid domain/);
});

test("accepts a real domain once hostKind is switched to domain", () => {
  const updated = updateDeploymentSettings({ publicHost: "db.example.com", hostKind: "domain" });
  assert.equal(updated.publicHost, "db.example.com");
  assert.equal(updated.hostKind, "domain");
  assert.equal(publicHost(), "db.example.com");
});

test("a partial patch leaves the other fields untouched", () => {
  const before = getDeploymentSettings();
  updateDeploymentSettings({ defaultTls: false });
  const after = getDeploymentSettings();
  assert.equal(after.publicHost, before.publicHost);
  assert.equal(after.hostKind, before.hostKind);
  assert.equal(after.defaultTls, false);
});
