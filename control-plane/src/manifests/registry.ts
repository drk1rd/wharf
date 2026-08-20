import type { ServiceManifest } from "./types.js";
import { postgresManifest } from "./postgres.js";
import { mongodbManifest } from "./mongodb.js";
import { mysqlManifest } from "./mysql.js";
import { redisManifest } from "./redis.js";
import { clickhouseManifest } from "./clickhouse.js";

const manifests: Record<string, ServiceManifest> = {
  postgres: postgresManifest,
  mongodb: mongodbManifest,
  mysql: mysqlManifest,
  redis: redisManifest,
  clickhouse: clickhouseManifest,
};

export function getManifest(engine: string): ServiceManifest | undefined {
  return manifests[engine];
}

export function listManifests(): ServiceManifest[] {
  return Object.values(manifests);
}
