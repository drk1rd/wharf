import { Client } from "pg";
import type { BrowseFilter, BrowseObject, BrowserAdapter, QueryResult } from "./types.js";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Safely quotes a Postgres identifier that isn't allowed to be parameterized. */
export function quoteIdent(ident: string): string {
  if (!IDENT_RE.test(ident)) {
    const err = new Error(`invalid identifier: ${ident}`);
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return `"${ident}"`;
}

const FILTER_OPS: Record<BrowseFilter["op"], string> = {
  "=": "=",
  "!=": "!=",
  ">": ">",
  "<": "<",
  ">=": ">=",
  "<=": "<=",
  contains: "ILIKE",
};

/** Builds a parameterized WHERE clause — values stay real bind params, never spliced into the query text. */
function buildWhere(filters: BrowseFilter[] | undefined): { clause: string; params: unknown[] } {
  if (!filters || filters.length === 0) return { clause: "", params: [] };
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const f of filters) {
    const sqlOp = FILTER_OPS[f.op];
    if (!sqlOp) {
      const err = new Error(`invalid filter operator: ${f.op}`);
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    params.push(f.op === "contains" ? `%${f.value}%` : f.value);
    parts.push(`${quoteIdent(f.column)} ${sqlOp} $${params.length}`);
  }
  return { clause: `WHERE ${parts.join(" AND ")}`, params };
}

async function withClient<T>(connectionString: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  // node-postgres's Client is an EventEmitter — if the server closes the
  // socket unexpectedly (e.g. Postgres's own initdb-then-restart cycle,
  // which the caller's readiness-retry loop deliberately runs into), it
  // emits "error" asynchronously. With zero listeners, Node's default
  // EventEmitter behavior is to throw, crashing the whole process instead of
  // just failing this one call — the real failure already surfaces through
  // the rejected connect()/query() promise below.
  client.on("error", () => undefined);
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

  async browseObject(connectionString, ref, limit, offset, filters): Promise<QueryResult> {
    const schema = quoteIdent(ref.schema ?? "public");
    const table = quoteIdent(ref.name);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const safeOffset = Math.max(Math.trunc(offset), 0);
    const { clause, params } = buildWhere(filters);
    return withClient(connectionString, async (client) => {
      const res = await client.query(
        `SELECT * FROM ${schema}.${table} ${clause} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, safeLimit, safeOffset]
      );
      return { columns: res.fields.map((f) => f.name), rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    });
  },

  async runQuery(connectionString, query): Promise<QueryResult> {
    return withClient(connectionString, async (client) => {
      const res = await client.query(query);
      return { columns: res.fields?.map((f) => f.name) ?? [], rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    });
  },

  async importRows(connectionString, target, rows): Promise<{ inserted: number }> {
    if (rows.length === 0) return { inserted: 0 };
    const table = quoteIdent(target);
    const columns = Object.keys(rows[0]);
    const quotedCols = columns.map(quoteIdent).join(", ");
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    return withClient(connectionString, async (client) => {
      let inserted = 0;
      for (const row of rows) {
        await client.query(`INSERT INTO ${table} (${quotedCols}) VALUES (${placeholders})`, columns.map((c) => row[c]));
        inserted++;
      }
      return { inserted };
    });
  },

  async getRowById(connectionString, table, idColumn, idValue): Promise<QueryResult> {
    const t = quoteIdent(table);
    const col = quoteIdent(idColumn);
    return withClient(connectionString, async (client) => {
      const res = await client.query(`SELECT * FROM ${t} WHERE ${col} = $1`, [idValue]);
      return { columns: res.fields.map((f) => f.name), rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    });
  },

  async updateRowById(connectionString, table, idColumn, idValue, patch): Promise<{ updated: number }> {
    const t = quoteIdent(table);
    const col = quoteIdent(idColumn);
    const columns = Object.keys(patch);
    if (columns.length === 0) return { updated: 0 };
    const setClause = columns.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(", ");
    return withClient(connectionString, async (client) => {
      const res = await client.query(
        `UPDATE ${t} SET ${setClause} WHERE ${col} = $${columns.length + 1}`,
        [...columns.map((c) => patch[c]), idValue]
      );
      return { updated: res.rowCount ?? 0 };
    });
  },

  async deleteRowById(connectionString, table, idColumn, idValue): Promise<{ deleted: number }> {
    const t = quoteIdent(table);
    const col = quoteIdent(idColumn);
    return withClient(connectionString, async (client) => {
      const res = await client.query(`DELETE FROM ${t} WHERE ${col} = $1`, [idValue]);
      return { deleted: res.rowCount ?? 0 };
    });
  },

  async seedSampleData(connectionString): Promise<void> {
    return withClient(connectionString, async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS customers (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER NOT NULL REFERENCES customers(id),
          item TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      // Only ever runs once, right after provisioning, so there's no need to
      // guard these inserts against being re-run — nothing else writes here first.
      await client.query(`
        INSERT INTO customers (name, email) VALUES
          ('Ada Lovelace', 'ada@example.com'),
          ('Grace Hopper', 'grace@example.com'),
          ('Alan Turing', 'alan@example.com');
      `);
      await client.query(`
        INSERT INTO orders (customer_id, item, amount_cents)
        SELECT id, 'Widget', 1999 FROM customers WHERE email = 'ada@example.com'
        UNION ALL
        SELECT id, 'Gadget', 4999 FROM customers WHERE email = 'grace@example.com'
        UNION ALL
        SELECT id, 'Gizmo', 2999 FROM customers WHERE email = 'alan@example.com';
      `);
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
