import { randomBytes } from "node:crypto";
import type { ServiceManifest } from "./types.js";

function genPassword(): string {
  return randomBytes(18).toString("base64url");
}

export const mongodbManifest: ServiceManifest = {
  id: "mongodb",
  displayName: "MongoDB",
  versions: ["7", "6"],
  defaultVersion: "7",
  image: (version) => `mongo:${version}`,
  containerPort: 27017,
  dataPath: "/data/db",
  makeSecrets: () => ({
    username: "wharf",
    password: genPassword(),
    database: "app",
  }),
  env: (s) => ({
    MONGO_INITDB_ROOT_USERNAME: s.username,
    MONGO_INITDB_ROOT_PASSWORD: s.password,
    MONGO_INITDB_DATABASE: s.database,
  }),
  connectionString: (s, host, port) =>
    `mongodb://${s.username}:${s.password}@${host}:${port}/${s.database}?authSource=admin`,
  browserAdapter: "mongodb",
  backup: {
    fileExt: "archive",
    dumpCmd: (s) => [
      "mongodump",
      "--username", s.username,
      "--password", s.password,
      "--authenticationDatabase", "admin",
      "--db", s.database,
      "--archive",
    ],
    restoreCmd: (s) => [
      "mongorestore",
      "--username", s.username,
      "--password", s.password,
      "--authenticationDatabase", "admin",
      "--archive",
      "--drop",
    ],
  },
  resourceDefaults: { cpu: "1", memoryMb: 512, diskGb: 2 },
  tls: {
    certDir: "/wharf-tls",
    runtimeUser: "mongodb",
    entrypoint: "docker-entrypoint.sh",
    // mongod wants cert+key in one PEM for --tlsCertificateKeyFile, hence
    // combined.pem (see tls.ts) rather than separate --tlsCertificateFile /
    // --tlsPrivateKeyFile flags (also supported, but this is mongod's own
    // documented preferred form). --bind_ip_all is spelled out explicitly
    // here rather than relying on docker-entrypoint.sh's own default-args
    // heuristic, since this manifest is already overriding the args docker-entrypoint.sh
    // would otherwise infer from a bare "mongod".
    args: (_s, certDir) => [
      "mongod",
      "--bind_ip_all",
      "--tlsMode", "preferTLS",
      "--tlsCertificateKeyFile", `${certDir}/combined.pem`,
      "--tlsCAFile", `${certDir}/ca.crt`,
      // Setting --tlsCAFile at all makes mongod default to REQUIRING a
      // client certificate signed by it (net.tls.allowConnectionsWithoutCertificates
      // defaults to false the moment a CA file is configured) — this is
      // server-only encryption, not mutual TLS, so clients (including the
      // control plane's own probe/browser-adapter connections, which never
      // present a client cert) need this explicitly or mongod silently
      // closes every connection right after the TLS handshake.
      "--tlsAllowConnectionsWithoutCertificates",
    ],
    // Both spelled out directly in the URI — the MongoDB driver (and the
    // official connection-string spec) reads tls/tlsAllowInvalidCertificates
    // straight from query params, no client-side code changes needed.
    internalConnectionSuffix: () => "&tls=true&tlsAllowInvalidCertificates=true",
    externalConnectionSuffix: () => "&tls=true&tlsAllowInvalidCertificates=true",
  },
};
