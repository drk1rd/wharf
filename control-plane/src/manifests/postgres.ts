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
};
