import fs from "node:fs";
import path from "node:path";
import forge from "node-forge";

// Persisted alongside the SQLite file in WHARF_DATA_DIR — this is the
// control plane's OWN filesystem (unlike a sibling container's, which it
// can't see directly; see docker.ts for how per-instance leaf certs get
// from here into a container). Generated once per deployment and reused for
// every instance's leaf cert from then on, so a deployer only ever needs to
// trust one CA, not one per database.
const dataDir = process.env.WHARF_DATA_DIR ?? path.join(process.cwd(), "data");
const tlsDir = path.join(dataDir, "tls");
const CA_CERT_PATH = path.join(tlsDir, "ca.crt");
const CA_KEY_PATH = path.join(tlsDir, "ca.key");

interface CA {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
  certPem: string;
}

let cachedCA: CA | undefined;

function randomSerial(): string {
  let sn = forge.util.bytesToHex(forge.random.getBytesSync(16));
  // A serial whose first byte's high bit is set would be read as negative
  // under DER's signed-integer encoding — pad with a leading zero byte.
  if (parseInt(sn[0], 16) >= 8) sn = "00" + sn;
  return sn;
}

function generateCA(): CA {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  const attrs = [
    { name: "commonName", value: "Wharf Self-Signed CA" },
    { name: "organizationName", value: "Wharf" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey, certPem: forge.pki.certificateToPem(cert) };
}

/** Loads the deployment's CA from disk, generating it once on first use. */
export function getOrCreateCA(): CA {
  if (cachedCA) return cachedCA;
  fs.mkdirSync(tlsDir, { recursive: true });
  if (fs.existsSync(CA_CERT_PATH) && fs.existsSync(CA_KEY_PATH)) {
    const certPem = fs.readFileSync(CA_CERT_PATH, "utf8");
    const keyPem = fs.readFileSync(CA_KEY_PATH, "utf8");
    cachedCA = { cert: forge.pki.certificateFromPem(certPem), key: forge.pki.privateKeyFromPem(keyPem), certPem };
    return cachedCA;
  }
  const ca = generateCA();
  // Cert is fine world-readable (it's public); the key is the deployment's
  // one CA private key and must never be group/world-readable.
  fs.writeFileSync(CA_CERT_PATH, ca.certPem, { mode: 0o644 });
  fs.writeFileSync(CA_KEY_PATH, forge.pki.privateKeyToPem(ca.key), { mode: 0o600 });
  cachedCA = ca;
  return ca;
}

/** The CA's public certificate only — safe to expose to a deployer who wants to trust it, or to download. Never the key. */
export function caCertificatePem(): string {
  return getOrCreateCA().certPem;
}

export interface LeafCert {
  certPem: string;
  keyPem: string;
  /** cert immediately followed by key in one PEM — some engines (mongod's tlsCertificateKeyFile) want exactly this combined form. */
  combinedPem: string;
  caCertPem: string;
}

/** Issues a fresh leaf certificate for one instance, signed by the deployment CA, valid for the given host (IP or domain). */
export function issueLeafCert(host: string): LeafCert {
  const ca = getOrCreateCA();
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  cert.setSubject([{ name: "commonName", value: host }]);
  cert.setIssuer(ca.cert.subject.attributes);

  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const altNames: { type: number; value?: string; ip?: string }[] = isIp
    ? [{ type: 7, ip: host }]
    : [{ type: 2, value: host }];
  if (host !== "localhost") altNames.push({ type: 2, value: "localhost" });
  if (!isIp) altNames.push({ type: 7, ip: "127.0.0.1" });

  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  return { certPem, keyPem, combinedPem: certPem + keyPem, caCertPem: ca.certPem };
}
