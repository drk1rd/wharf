import { randomBytes } from "node:crypto";
import type { ServiceManifest } from "./types.js";

function genPassword(): string {
  return randomBytes(18).toString("base64url");
}

export const postgresManifest: ServiceManifest = {
  id: "postgres",
  displayName: "PostgreSQL",
  versions: ["16", "15", "14"],
  defaultVersion: "16",
  image: (version) => `postgres:${version}-alpine`,
  containerPort: 5432,
  dataPath: "/var/lib/postgresql/data",
  makeSecrets: () => ({
    username: "wharf",
    password: genPassword(),
    database: "app",
  }),
  env: (s) => ({
    POSTGRES_USER: s.username,
    POSTGRES_PASSWORD: s.password,
    POSTGRES_DB: s.database,
  }),
  connectionString: (s, host, port) =>
    `postgres://${s.username}:${s.password}@${host}:${port}/${s.database}`,
  browserAdapter: "postgres",
  backup: {
    fileExt: "sql",
    dumpCmd: (s) => ["pg_dump", "-U", s.username, "-d", s.database],
    restoreCmd: (s) => ["psql", "-U", s.username, "-d", s.database],
  },
  resourceDefaults: { cpu: "1", memoryMb: 512, diskGb: 2 },
  tls: {
    certDir: "/wharf-tls",
    runtimeUser: "postgres",
    entrypoint: "docker-entrypoint.sh",
    args: (_s, certDir) => [
      "postgres",
      "-c", "ssl=on",
      "-c", `ssl_cert_file=${certDir}/server.crt`,
      "-c", `ssl_key_file=${certDir}/server.key`,
      "-c", `ssl_ca_file=${certDir}/ca.crt`,
    ],
    // node-postgres's connection-string parser (pg-connection-string) reads
    // sslmode itself: "no-verify" encrypts without checking the leaf cert
    // against a trusted root — correct for the control plane's own traffic,
    // which is connecting to a cert signed by Wharf's own CA, not a public one.
    internalConnectionSuffix: () => "?sslmode=no-verify",
    // "require" (not "no-verify") for what's handed to end users: encrypts
    // the connection without requiring them to import the deployment's CA
    // first — the same "on by default, verify is opt-in" tradeoff most
    // self-signed-CA setups make. The CA cert itself is downloadable from
    // Settings for anyone who wants to upgrade to sslmode=verify-full.
    externalConnectionSuffix: () => "?sslmode=require",
  },
};
