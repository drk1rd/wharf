import { MongoClient } from "mongodb";
import type { BrowseObject, BrowserAdapter, QueryResult } from "./types.js";

async function withClient<T>(connectionString: string, fn: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export const mongodbAdapter: BrowserAdapter = {
  async listObjects(connectionString): Promise<BrowseObject[]> {
    return withClient(connectionString, async (client) => {
      const db = client.db();
      const collections = await db.listCollections().toArray();
      const objects: BrowseObject[] = [];
      for (const col of collections) {
        const count = await db.collection(col.name).estimatedDocumentCount().catch(() => null);
        objects.push({ name: col.name, approxRowCount: count });
      }
      return objects;
    });
  },

  async browseObject(connectionString, ref, limit, offset): Promise<QueryResult> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const safeOffset = Math.max(Math.trunc(offset), 0);
    return withClient(connectionString, async (client) => {
      const db = client.db();
      const docs = await db.collection(ref.name).find({}).skip(safeOffset).limit(safeLimit).toArray();
      return { rows: docs, rowCount: docs.length };
    });
  },

  /**
   * `query` is a JSON string: { "collection": "users", "filter": { ... }, "limit"?: number }.
   * We only ever run a structured find() — no eval/$where — so this can't become remote code
   * execution against the container the way an arbitrary JS runner would.
   */
  async runQuery(connectionString, query): Promise<QueryResult> {
    let parsed: { collection: string; filter?: Record<string, unknown>; limit?: number };
    try {
      parsed = JSON.parse(query);
    } catch {
      throw new Error('query must be JSON: {"collection": "...", "filter": {...}}');
    }
    if (!parsed.collection || typeof parsed.collection !== "string") {
      throw new Error('query must include a "collection" name');
    }
    const limit = Math.min(Math.max(Math.trunc(parsed.limit ?? 100), 1), 1000);
    return withClient(connectionString, async (client) => {
      const db = client.db();
      const docs = await db
        .collection(parsed.collection)
        .find(parsed.filter ?? {})
        .limit(limit)
        .toArray();
      return { rows: docs, rowCount: docs.length };
    });
  },
};
