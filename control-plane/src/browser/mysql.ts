import mysql from "mysql2/promise";
import type { BrowseObject, BrowserAdapter, QueryResult } from "./types.js";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Safely backtick-quotes a MySQL identifier that isn't allowed to be parameterized. */
export function quoteIdent(ident: string): string {
  if (!IDENT_RE.test(ident)) {
    throw new Error(`invalid identifier: ${ident}`);
  }
  return `\`${ident}\``;
}

async function withConnection<T>(connectionString: string, fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection({ uri: connectionString, connectTimeout: 8000 });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

export const mysqlAdapter: BrowserAdapter = {
  async listObjects(connectionString): Promise<BrowseObject[]> {
    return withConnection(connectionString, async (conn) => {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT table_name, table_rows
         FROM information_schema.tables
         WHERE table_schema = database() AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      );
      return rows.map((r) => ({ name: r.table_name as string, approxRowCount: (r.table_rows as number) ?? null }));
    });
  },

  async browseObject(connectionString, ref, limit, offset): Promise<QueryResult> {
    const table = quoteIdent(ref.name);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const safeOffset = Math.max(Math.trunc(offset), 0);
    return withConnection(connectionString, async (conn) => {
      const [rows, fields] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT * FROM ${table} LIMIT ? OFFSET ?`,
        [safeLimit, safeOffset]
      );
      return { columns: fields.map((f) => f.name), rows, rowCount: rows.length };
    });
  },

  async runQuery(connectionString, query): Promise<QueryResult> {
    return withConnection(connectionString, async (conn) => {
      const [rows, fields] = await conn.query(query);
      const columns = Array.isArray(fields) ? fields.map((f) => f.name) : [];
      const resultRows = Array.isArray(rows) ? rows : [rows];
      return { columns, rows: resultRows, rowCount: resultRows.length };
    });
  },

  async importRows(connectionString, target, rows): Promise<{ inserted: number }> {
    if (rows.length === 0) return { inserted: 0 };
    const table = quoteIdent(target);
    const columns = Object.keys(rows[0]);
    const quotedCols = columns.map(quoteIdent).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    return withConnection(connectionString, async (conn) => {
      let inserted = 0;
      for (const row of rows) {
        await conn.query(`INSERT INTO ${table} (${quotedCols}) VALUES (${placeholders})`, columns.map((c) => row[c]));
        inserted++;
      }
      return { inserted };
    });
  },

  async seedSampleData(connectionString): Promise<void> {
    return withConnection(connectionString, async (conn) => {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS customers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await conn.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          customer_id INT NOT NULL,
          item VARCHAR(255) NOT NULL,
          amount_cents INT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (customer_id) REFERENCES customers(id)
        )
      `);
      // Only ever runs once, right after provisioning — nothing else writes here first.
      await conn.query(
        `INSERT INTO customers (name, email) VALUES (?, ?), (?, ?), (?, ?)`,
        ["Ada Lovelace", "ada@example.com", "Grace Hopper", "grace@example.com", "Alan Turing", "alan@example.com"]
      );
      await conn.query(`
        INSERT INTO orders (customer_id, item, amount_cents)
        SELECT id, 'Widget', 1999 FROM customers WHERE email = 'ada@example.com'
        UNION ALL
        SELECT id, 'Gadget', 4999 FROM customers WHERE email = 'grace@example.com'
        UNION ALL
        SELECT id, 'Gizmo', 2999 FROM customers WHERE email = 'alan@example.com'
      `);
    });
  },

  async getSchemaContext(connectionString): Promise<string> {
    return withConnection(connectionString, async (conn) => {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT table_name, column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = database()
         ORDER BY table_name, ordinal_position
         LIMIT 2000`
      );
      const byTable = new Map<string, string[]>();
      for (const row of rows) {
        const key = row.table_name as string;
        if (!byTable.has(key)) byTable.set(key, []);
        byTable.get(key)!.push(`${row.column_name} ${row.data_type}`);
      }
      const lines = [...byTable.entries()].slice(0, 60).map(([table, cols]) => `${table}(${cols.slice(0, 40).join(", ")})`);
      return lines.length > 0 ? lines.join("\n") : "(no tables found)";
    });
  },
};
