import { createClient } from "redis";
import type { BrowseObject, BrowserAdapter, QueryResult } from "./types.js";

async function withClient<T>(connectionString: string, fn: (client: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  const client = createClient({ url: connectionString, socket: { connectTimeout: 8000 } });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.quit();
  }
}

/** Splits a command line into argv, respecting "double" and 'single' quoted segments. */
function tokenize(commandLine: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(commandLine)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

async function describeKey(client: ReturnType<typeof createClient>, key: string): Promise<unknown> {
  const type = await client.type(key);
  switch (type) {
    case "string":
      return await client.get(key);
    case "hash":
      return await client.hGetAll(key);
    case "list":
      return await client.lRange(key, 0, 199);
    case "set":
      return await client.sMembers(key);
    case "zset":
      return await client.zRangeWithScores(key, 0, 199);
    default:
      return { type };
  }
}

export const redisAdapter: BrowserAdapter = {
  async listObjects(connectionString): Promise<BrowseObject[]> {
    return withClient(connectionString, async (client) => {
      const objects: BrowseObject[] = [];
      let cursor = 0;
      do {
        const res = await client.scan(cursor, { COUNT: 100 });
        cursor = res.cursor;
        for (const key of res.keys) objects.push({ name: key, approxRowCount: null });
        if (objects.length >= 200) break;
      } while (cursor !== 0);
      return objects;
    });
  },

  async browseObject(connectionString, ref): Promise<QueryResult> {
    return withClient(connectionString, async (client) => {
      const value = await describeKey(client, ref.name);
      const type = await client.type(ref.name);
      return { columns: ["key", "type", "value"], rows: [{ key: ref.name, type, value }], rowCount: 1 };
    });
  },

  /** `query` is a raw command line, e.g. `GET session:42` or `HGETALL user:1` — same idea as redis-cli. */
  async runQuery(connectionString, query): Promise<QueryResult> {
    const args = tokenize(query.trim());
    if (args.length === 0) throw new Error("empty command");
    return withClient(connectionString, async (client) => {
      const result = await client.sendCommand(args);
      const rows = Array.isArray(result) ? result : [result];
      return { rows, rowCount: rows.length };
    });
  },

  /** Redis has no real schema — this samples a few keys and reports name + type. */
  async getSchemaContext(connectionString): Promise<string> {
    return withClient(connectionString, async (client) => {
      const res = await client.scan(0, { COUNT: 100 });
      const lines: string[] = [];
      for (const key of res.keys.slice(0, 40)) {
        const type = await client.type(key);
        lines.push(`${key}: ${type}`);
      }
      return lines.length > 0 ? lines.join("\n") : "(no keys found)";
    });
  },
};
