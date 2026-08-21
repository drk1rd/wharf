import { createClient } from "redis";
import type { BrowseObject, BrowserAdapter, QueryResult } from "./types.js";

async function withClient<T>(connectionString: string, fn: (client: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  const client = createClient({ url: connectionString, socket: { connectTimeout: 8000 } });
  // Same reasoning as postgres.ts's withClient: node-redis's client is an
  // EventEmitter that throws on an unhandled "error" (e.g. "Socket closed
  // unexpectedly" while Redis itself is still starting up, which the
  // caller's readiness-retry loop runs into directly) — without a listener
  // that crashes the process instead of just failing this call.
  client.on("error", () => undefined);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.quit();
  }
}

/** Splits a command line into argv, respecting "double" and 'single' quoted segments. */
export function tokenize(commandLine: string): string[] {
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

  /**
   * A full backup redis-cli can't give us in one shot: DUMP is the RESP
   * serialization of one key's value, so this walks every key (no cap —
   * unlike listObjects, this must be complete) and stores {key, ttlMs, data}
   * per key, base64-encoding DUMP's binary payload so it survives JSON.
   */
  async dumpAll(connectionString): Promise<Buffer> {
    return withClient(connectionString, async (client) => {
      const entries: { key: string; ttlMs: number; data: string }[] = [];
      let cursor = 0;
      do {
        const res = await client.scan(cursor, { COUNT: 200 });
        cursor = res.cursor;
        for (const key of res.keys) {
          // DUMP's payload is arbitrary binary — must go through returnBuffers,
          // never the client's default string decoding, or it silently corrupts.
          const [dump, pttl] = await Promise.all([
            client.sendCommand<Buffer | null>(["DUMP", key], { returnBuffers: true }),
            client.pTTL(key),
          ]);
          if (dump === null) continue; // key expired between SCAN and DUMP
          entries.push({ key, ttlMs: pttl > 0 ? pttl : 0, data: dump.toString("base64") });
        }
      } while (cursor !== 0);
      return Buffer.from(JSON.stringify({ format: "wharf-redis-dump-v1", entries }), "utf8");
    });
  },

  /** Redis has no table/collection to import into — each row is `{ key, value }` and `target` is unused. */
  async importRows(connectionString, _target, rows): Promise<{ inserted: number }> {
    return withClient(connectionString, async (client) => {
      let inserted = 0;
      for (const row of rows) {
        const key = row.key;
        if (typeof key !== "string" || !key) continue;
        const value = row.value;
        await client.set(key, typeof value === "string" ? value : JSON.stringify(value ?? ""));
        inserted++;
      }
      return { inserted };
    });
  },

  async seedSampleData(connectionString): Promise<void> {
    return withClient(connectionString, async (client) => {
      await client.set("session:demo", "example-session-token");
      await client.hSet("user:1", { name: "Ada Lovelace", email: "ada@example.com" });
      await client.rPush("recent:signups", ["ada@example.com", "grace@example.com", "alan@example.com"]);
      await client.sAdd("tags:featured", ["widget", "gadget", "gizmo"]);
    });
  },

  async restoreAll(connectionString, data): Promise<void> {
    const parsed = JSON.parse(data.toString("utf8")) as {
      format?: string;
      entries: { key: string; ttlMs: number; data: string }[];
    };
    if (parsed.format !== "wharf-redis-dump-v1") {
      throw new Error("this backup wasn't produced by Wharf's Redis dump — refusing to restore it");
    }
    return withClient(connectionString, async (client) => {
      for (const entry of parsed.entries) {
        const payload = Buffer.from(entry.data, "base64");
        await client.sendCommand(["RESTORE", entry.key, String(entry.ttlMs), payload, "REPLACE"]);
      }
    });
  },
};
