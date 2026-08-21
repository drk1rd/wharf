import { randomBytes } from "node:crypto";
import type { ServiceManifest } from "./types.js";

function genPassword(): string {
  return randomBytes(18).toString("base64url");
}

export const mysqlManifest: ServiceManifest = {
  id: "mysql",
  displayName: "MySQL",
  versions: ["8.4", "8.0"],
  defaultVersion: "8.0",
  image: (version) => `mysql:${version}`,
  containerPort: 3306,
  dataPath: "/var/lib/mysql",
  makeSecrets: () => ({
    username: "wharf",
    // MYSQL_ROOT_PASSWORD is set to the same value — root is used internally
    // (by backup/restore) but never handed to the user, who only ever sees
    // the "wharf" app user's credentials below.
    password: genPassword(),
    database: "app",
  }),
  env: (s) => ({
    MYSQL_ROOT_PASSWORD: s.password,
    MYSQL_USER: s.username,
    MYSQL_PASSWORD: s.password,
    MYSQL_DATABASE: s.database,
  }),
  connectionString: (s, host, port) => `mysql://${s.username}:${s.password}@${host}:${port}/${s.database}`,
  browserAdapter: "mysql",
  backup: {
    fileExt: "sql",
    dumpCmd: (s) => ["mysqldump", "-uroot", `-p${s.password}`, "--no-tablespaces", s.database],
    restoreCmd: (s) => ["mysql", "-uroot", `-p${s.password}`, s.database],
  },
  resourceDefaults: { cpu: "1", memoryMb: 512, diskGb: 2 },
};
