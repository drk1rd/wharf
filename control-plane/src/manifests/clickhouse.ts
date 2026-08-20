import { randomBytes } from "node:crypto";
import type { ServiceManifest } from "./types.js";

function genPassword(): string {
  return randomBytes(18).toString("base64url");
}

export const clickhouseManifest: ServiceManifest = {
  id: "clickhouse",
  displayName: "ClickHouse",
  // "latest" rather than a pinned numbered tag like the other four manifests
  // use — this was added without live Docker Hub access (this environment's
  // network policy blocks it all session, same reason noted throughout
  // PLAN.md), so a specific version tag couldn't be verified to actually
  // exist. Worth pinning to a real numbered tag once someone can confirm one
  // against the real registry.
  versions: ["latest"],
  defaultVersion: "latest",
  image: (version) => `clickhouse/clickhouse-server:${version}`,
  // HTTP interface only (8123) — simplest correct way to talk to ClickHouse
  // (POST a SQL query, get FORMAT JSON back) without adding a native-protocol
  // client dependency. The native TCP protocol (9000) isn't exposed here.
  containerPort: 8123,
  dataPath: "/var/lib/clickhouse",
  makeSecrets: () => ({
    username: "wharf",
    password: genPassword(),
    database: "app",
  }),
  env: (s) => ({
    CLICKHOUSE_USER: s.username,
    CLICKHOUSE_PASSWORD: s.password,
    CLICKHOUSE_DB: s.database,
  }),
  connectionString: (s, host, port) => `http://${s.username}:${s.password}@${host}:${port}/?database=${s.database}`,
  browserAdapter: "clickhouse",
  // No exec-based `backup`: doing this correctly needs either a shell
  // pipeline over clickhouse-client's dump formats or the HTTP interface's
  // well-documented JSONEachRow format. The former couldn't be verified
  // against a real instance in this environment (network-blocked all
  // session) and an unverified backup mechanism is worse than none — it
  // fails silently and confidently. Backs up via the browser adapter's
  // dumpAll/restoreAll instead, built on JSONEachRow, which is stable,
  // extremely standard ClickHouse behavior — see browser/clickhouse.ts.
  resourceDefaults: { cpu: "1", memoryMb: 1024, diskGb: 4 },
};
