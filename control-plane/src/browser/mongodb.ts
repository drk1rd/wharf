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

  async importRows(connectionString, target, rows): Promise<{ inserted: number }> {
    if (rows.length === 0) return { inserted: 0 };
    return withClient(connectionString, async (client) => {
      const res = await client.db().collection(target).insertMany(rows);
      return { inserted: res.insertedCount };
    });
  },

  async seedSampleData(connectionString): Promise<void> {
    return withClient(connectionString, async (client) => {
      const db = client.db();
      const customers = await db.collection("customers").insertMany([
        { name: "Ada Lovelace", email: "ada@example.com" },
        { name: "Grace Hopper", email: "grace@example.com" },
        { name: "Alan Turing", email: "alan@example.com" },
      ]);
      const ids = Object.values(customers.insertedIds);
      await db.collection("orders").insertMany([
        { customerId: ids[0], item: "Widget", amountCents: 1999 },
        { customerId: ids[1], item: "Gadget", amountCents: 4999 },
        { customerId: ids[2], item: "Gizmo", amountCents: 2999 },
      ]);
    });
  },

  /** MongoDB is schemaless, so this samples a few documents per collection to infer field shapes. */
  async getSchemaContext(connectionString): Promise<string> {
    return withClient(connectionString, async (client) => {
      const db = client.db();
      const collections = await db.listCollections().toArray();
      const lines: string[] = [];
      for (const col of collections.slice(0, 40)) {
        const sample = await db.collection(col.name).find({}).limit(3).toArray();
        const fieldTypes = new Map<string, string>();
        for (const doc of sample) {
          for (const [key, value] of Object.entries(doc)) {
            if (!fieldTypes.has(key)) fieldTypes.set(key, bsonTypeName(value));
          }
        }
        const fields = [...fieldTypes.entries()]
          .slice(0, 30)
          .map(([key, type]) => `${key}: ${type}`)
          .join(", ");
        lines.push(`${col.name}: {${fields}}`);
      }
      return lines.length > 0 ? lines.join("\n") : "(no collections found)";
    });
  },
};

function bsonTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "Date";
  if (typeof value === "object") {
    const ctorName = (value as { _bsontype?: string }).constructor?.name;
    if (ctorName === "ObjectId" || ctorName === "ObjectID") return "ObjectId";
    return ctorName ?? "object";
  }
  return typeof value;
}
