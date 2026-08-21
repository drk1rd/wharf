import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// tls.ts reads WHARF_DATA_DIR at module load (same reasoning as every other
// test file's dynamic-import comment: a static import would be hoisted and
// evaluated before this env var is set, silently pointing at the real,
// un-isolated data directory instead of this run's temp one).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wharf-tls-test-"));
process.env.WHARF_DATA_DIR = dataDir;

const { getOrCreateCA, issueLeafCert, caCertificatePem } = await import("../tls.js");
const { buildTarArchive } = await import("../tar.js");
const forge = (await import("node-forge")).default;

test("getOrCreateCA generates once and persists to disk", () => {
  const ca1 = getOrCreateCA();
  assert.ok(fs.existsSync(path.join(dataDir, "tls", "ca.crt")));
  assert.ok(fs.existsSync(path.join(dataDir, "tls", "ca.key")));
  const keyStat = fs.statSync(path.join(dataDir, "tls", "ca.key"));
  // eslint-disable-next-line no-bitwise
  assert.equal(keyStat.mode & 0o777, 0o600, "the CA private key must not be group/world readable");

  const ca2 = getOrCreateCA();
  assert.equal(ca1.certPem, ca2.certPem, "a second call should reuse the persisted CA, not generate a new one");
});

test("caCertificatePem never leaks the private key", () => {
  const pem = caCertificatePem();
  assert.ok(pem.includes("BEGIN CERTIFICATE"));
  assert.ok(!pem.includes("PRIVATE KEY"));
});

test("issueLeafCert produces a cert signed by the deployment CA, with SAN matching the host", () => {
  const ca = getOrCreateCA();
  const leaf = issueLeafCert("192.168.1.50");
  const leafCert = forge.pki.certificateFromPem(leaf.certPem);

  assert.equal(leafCert.issuer.getField("CN")?.value, "Wharf Self-Signed CA");
  assert.ok(ca.cert.verify(leafCert), "the leaf cert must actually verify against the CA's public key");

  const san = leafCert.getExtension("subjectAltName") as { altNames: { type: number; ip?: string; value?: string }[] };
  assert.ok(san.altNames.some((n) => n.type === 7 && n.ip === "192.168.1.50"), "an IP host should get an IP SAN entry, not a DNS one");

  assert.equal(leaf.combinedPem, leaf.certPem + leaf.keyPem);
  assert.equal(leaf.caCertPem, ca.certPem);
});

test("issueLeafCert for a domain host gets a DNS SAN plus localhost/127.0.0.1 fallbacks", () => {
  const leaf = issueLeafCert("db.example.com");
  const leafCert = forge.pki.certificateFromPem(leaf.certPem);
  const san = leafCert.getExtension("subjectAltName") as { altNames: { type: number; ip?: string; value?: string }[] };
  assert.ok(san.altNames.some((n) => n.type === 2 && n.value === "db.example.com"));
  assert.ok(san.altNames.some((n) => n.type === 2 && n.value === "localhost"));
  assert.ok(san.altNames.some((n) => n.type === 7 && n.ip === "127.0.0.1"));
});

test("buildTarArchive round-trips through a real USTAR reader", () => {
  const tar = buildTarArchive([
    { name: "wharf-tls/server.crt", content: Buffer.from("hello cert"), mode: 0o644 },
    { name: "wharf-tls/server.key", content: Buffer.from("hello key, a bit longer than one block".repeat(20)), mode: 0o600 },
  ]);

  // Archive length must be a multiple of 512 (USTAR block size), and end
  // with the two zero-block terminator.
  assert.equal(tar.length % 512, 0);
  assert.ok(tar.subarray(tar.length - 1024).every((b) => b === 0));

  // Parse it back by hand (no tar dependency in this repo) and confirm both
  // entries round-trip with the right name, mode, and content.
  let offset = 0;
  const entries: { name: string; mode: number; content: Buffer }[] = [];
  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const mode = parseInt(header.subarray(100, 108).toString("utf8").replace(/\0.*$/s, ""), 8);
    const size = parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/s, ""), 8);
    const content = tar.subarray(offset + 512, offset + 512 + size);
    entries.push({ name, mode, content: Buffer.from(content) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, "wharf-tls/server.crt");
  assert.equal(entries[0].mode, 0o644);
  assert.equal(entries[0].content.toString("utf8"), "hello cert");
  assert.equal(entries[1].name, "wharf-tls/server.key");
  assert.equal(entries[1].mode, 0o600);
  assert.equal(entries[1].content.toString("utf8"), "hello key, a bit longer than one block".repeat(20));
});

test("buildTarArchive rejects a name too long for USTAR's 100-byte field", () => {
  assert.throws(() => buildTarArchive([{ name: "x".repeat(100), content: Buffer.from("a") }]));
});
