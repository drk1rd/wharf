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
  tls: {
    certDir: "/wharf-tls",
    runtimeUser: "mysql",
    entrypoint: "docker-entrypoint.sh",
    args: (_s, certDir) => [
      "mysqld",
      `--ssl-cert=${certDir}/server.crt`,
      `--ssl-key=${certDir}/server.key`,
      `--ssl-ca=${certDir}/ca.crt`,
    ],
    // "?ssl=true" is a marker mysql.ts's own withClient() looks for, not a
    // mysql2-native URI param — mysql2's URI parsing doesn't reliably turn
    // query-string ssl flags into a real TLS options object, so the browser
    // adapter parses this itself and passes { rejectUnauthorized: false }
    // as an explicit sibling option instead. Same suffix for internal and
    // external: mysql2 is the only client this repo's own code drives
    // against these instances, and framework connect snippets in the UI
    // already show engine-appropriate ssl config for other clients.
    internalConnectionSuffix: () => "?ssl=true",
    externalConnectionSuffix: () => "?ssl=true",
  },
};
