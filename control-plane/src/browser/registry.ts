import type { BrowserAdapter } from "./types.js";
import { postgresAdapter } from "./postgres.js";
import { mongodbAdapter } from "./mongodb.js";
import { mysqlAdapter } from "./mysql.js";
import { redisAdapter } from "./redis.js";
import { clickhouseAdapter } from "./clickhouse.js";
import type { BrowserAdapterId } from "../manifests/types.js";

const adapters: Record<BrowserAdapterId, BrowserAdapter> = {
  postgres: postgresAdapter,
  mongodb: mongodbAdapter,
  mysql: mysqlAdapter,
  redis: redisAdapter,
  clickhouse: clickhouseAdapter,
};

export function getBrowserAdapter(id: BrowserAdapterId): BrowserAdapter {
  return adapters[id];
}
