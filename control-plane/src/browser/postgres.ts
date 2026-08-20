import { Client } from "pg";
import type { BrowseObject, BrowserAdapter, QueryResult } from "./types.js";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Safely quotes a Postgres identifier that isn't allowed to be parameterized. */
function quoteIdent(ident: string): string {
  if (!IDENT_RE.test(ident)) {
    throw new Error(`invalid identifier: ${ident}`);
  }
  return `"${ident}"`;
}

async function withClient<T>(connectionString: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const postgresAdapter: BrowserAdapter = {
  async listObjects(connectionString): Promise<BrowseObject[]> {
    return withClient(connectionString, async (client) => {
      const res = await client.query<{ table_name: string; table_schema: string; row_estimate: number | null }>(
        `SELECT c.relname AS table_name, n.nspname AS table_schema, c.reltuples::bigint AS row_estimate
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY n.nspname, c.relname`
      );
      return res.rows.map((r) => ({
        name: r.table_name,
        schema: r.table_schema,
        approxRowCount: r.row_estimate,
      }));
    });
  },

  async browseObject(connectionString, ref, limit, offset): Promise<QueryResult> {
    const schema = quoteIdent(ref.schema ?? "public");
    const table = quoteIdent(ref.name);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const safeOffset = Math.max(Math.trunc(offset), 0);
    return withClient(connectionString, async (client) => {
      const res = await client.query(`SELECT * FROM ${schema}.${table} LIMIT $1 OFFSET $2`, [safeLimit, safeOffset]);
      return { columns: res.fields.map((f) => f.name), rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    });
  },

  async runQuery(connectionString, query): Promise<QueryResult> {
    return withClient(connectionString, async (client) => {
      const res = await client.query(query);
      return { columns: res.fields?.map((f) => f.name) ?? [], rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    });
  },

  async getSchemaContext(connectionString): Promise<string> {
    return withClient(connectionString, async (client) => {
      const res = await client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
        `SELECT table_schema, table_name, column_name, data_type
         FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name, ordinal_position
         LIMIT 2000`
      );
      const byTable = new Map<string, string[]>();
      for (const row of res.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!byTable.has(key)) byTable.set(key, []);
        byTable.get(key)!.push(`${row.column_name} ${row.data_type}`);
      }
      const lines = [...byTable.entries()]
        .slice(0, 60)
        .map(([table, cols]) => `${table}(${cols.slice(0, 40).join(", ")})`);
      return lines.length > 0 ? lines.join("\n") : "(no tables found)";
    });
  },
};
