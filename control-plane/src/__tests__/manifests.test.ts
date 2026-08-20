import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresManifest } from "../manifests/postgres.js";
import { mongodbManifest } from "../manifests/mongodb.js";
import { mysqlManifest } from "../manifests/mysql.js";
import { redisManifest } from "../manifests/redis.js";
import { getManifest, listManifests } from "../manifests/registry.js";

const manifests = [postgresManifest, mongodbManifest, mysqlManifest, redisManifest];

test("every manifest resolves its default version's image", () => {
  for (const m of manifests) {
    assert.ok(m.versions.includes(m.defaultVersion), `${m.id}: defaultVersion must be one of versions`);
    const image = m.image(m.defaultVersion);
    assert.ok(image.length > 0, `${m.id}: image() must return a non-empty string`);
  }
});

test("every manifest's connection string embeds host, port, and generated credentials", () => {
  for (const m of manifests) {
    const secrets = m.makeSecrets("test-instance");
    const conn = m.connectionString(secrets, "example.test", 54321);
    assert.match(conn, /example\.test/, `${m.id}: connection string must include the host`);
    assert.match(conn, /54321/, `${m.id}: connection string must include the port`);
    assert.match(conn, new RegExp(secrets.password), `${m.id}: connection string must include the password`);
  }
});

test("generated passwords are non-trivial and different per instance", () => {
  for (const m of manifests) {
    const a = m.makeSecrets("instance-a");
    const b = m.makeSecrets("instance-b");
    assert.notEqual(a.password, b.password, `${m.id}: passwords must not be reused across instances`);
    assert.ok(a.password.length >= 16, `${m.id}: password should be a real random secret, not a placeholder`);
  }
});

test("registry resolves all four shipped engines and nothing else", () => {
  assert.equal(getManifest("postgres")?.id, "postgres");
  assert.equal(getManifest("mongodb")?.id, "mongodb");
  assert.equal(getManifest("mysql")?.id, "mysql");
  assert.equal(getManifest("redis")?.id, "redis");
  assert.equal(getManifest("not-a-real-engine"), undefined);
  assert.equal(listManifests().length, 4);
});

test("redis is the only manifest requiring a command override (password must be a CLI arg, not env)", () => {
  const secrets = redisManifest.makeSecrets("x");
  assert.ok(redisManifest.command, "redis manifest must define command()");
  const cmd = redisManifest.command!(secrets);
  assert.ok(cmd.includes("--requirepass"), "redis command must pass --requirepass");
  assert.ok(cmd.includes(secrets.password), "redis command must include the generated password");

  for (const m of [postgresManifest, mongodbManifest, mysqlManifest]) {
    assert.equal(m.command, undefined, `${m.id}: should configure itself via env(), not command()`);
  }
});

test("redis is the only manifest without backup/restore support", () => {
  assert.ok(postgresManifest.backup, "postgres should support backup/restore");
  assert.ok(mongodbManifest.backup, "mongodb should support backup/restore");
  assert.ok(mysqlManifest.backup, "mysql should support backup/restore");
  assert.equal(redisManifest.backup, undefined, "redis intentionally has no backup/restore path — see PLAN.md §6.2a");
});
