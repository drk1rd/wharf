import { randomBytes } from "node:crypto";
import type { ServiceManifest } from "./types.js";

function genPassword(): string {
  return randomBytes(18).toString("base64url");
}

export const redisManifest: ServiceManifest = {
  id: "redis",
  displayName: "Redis",
  versions: ["7", "6"],
  defaultVersion: "7",
  image: (version) => `redis:${version}-alpine`,
  containerPort: 6379,
  dataPath: "/data",
  // The stock redis image has no env-var way to require a password — it has
  // to be a server argument.
  command: (s) => ["redis-server", "--requirepass", s.password, "--appendonly", "yes"],
  makeSecrets: () => ({
    // Redis 6+ ACL default user is named "default"; there's no per-user
    // concept here beyond that, and "0" is the default logical database index.
    username: "default",
    password: genPassword(),
    database: "0",
  }),
  env: () => ({}),
  connectionString: (s, host, port) => `redis://:${s.password}@${host}:${port}/${s.database}`,
  browserAdapter: "redis",
  // No `backup`: redis-cli has a reliable stdout RDB stream (`--rdb -`) for a
  // dump, but no equivalent stdin-based restore path — restoring an RDB file
  // means replacing it on disk and restarting the server, which doesn't fit
  // the generic exec-dump/exec-restore mechanism the other engines use. Left
  // out rather than shipped half-working; see PLAN.md.
  resourceDefaults: { cpu: "0.5", memoryMb: 256, diskGb: 1 },
};
