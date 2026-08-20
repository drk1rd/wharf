import { test } from "node:test";
import assert from "node:assert/strict";
import { backupSupported } from "../backups.js";

test("backupSupported is true for every shipped engine, including redis and clickhouse (adapter-level dump/restore)", () => {
  assert.equal(backupSupported("postgres"), true);
  assert.equal(backupSupported("mongodb"), true);
  assert.equal(backupSupported("mysql"), true);
  assert.equal(backupSupported("redis"), true);
  assert.equal(backupSupported("clickhouse"), true);
});

test("backupSupported is false for an unknown engine", () => {
  assert.equal(backupSupported("not-a-real-engine"), false);
});
