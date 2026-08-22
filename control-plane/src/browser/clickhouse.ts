import type { BrowseFilter, BrowseObject, BrowserAdapter, QueryResult } from "./types.js";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Safely backtick-quotes a ClickHouse identifier that isn't allowed to be parameterized. */
export function quoteIdent(ident: string): string {
  if (!IDENT_RE.test(ident)) {
    const err = new Error(`invalid identifier: ${ident}`);
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return `\`${ident}\``;
}

interface ConnParts {
  origin: string;
  user: string;
  password: string;
  database: string;
}

function parseConnection(connectionString: string): ConnParts {
  const url = new URL(connectionString);
  return {
    origin: `${url.protocol}//${url.hostname}:${url.port}`,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.searchParams.get("database") ?? "default",
  };
}

// Only SELECT-shaped statements produce tabular output ClickHouse can wrap in
// FORMAT JSON. Appending it to DDL/DML (CREATE TABLE, INSERT ... VALUES, ...)
// either errors outright or silently conflicts with inline VALUES data —
// found for real in CI, where an INSERT immediately followed by a SELECT
// came back empty because the FORMAT JSON tacked onto the INSERT broke it.
const READ_QUERY_RE = /^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXISTS|EXPLAIN)\b/i;

/** POSTs a query to ClickHouse's HTTP interface and parses the FORMAT JSON envelope. */
async function query(connectionString: string, sql: string): Promise<{ columns: string[]; rows: unknown[] }> {
  const { origin, user, password, database } = parseConnection(connectionString);
  const url = `${origin}/?database=${encodeURIComponent(database)}&user=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}`;
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const hasFormat = /\bFORMAT\s+\w+\s*$/i.test(trimmed);
  const isRead = READ_QUERY_RE.test(trimmed);
  const body = hasFormat || !isRead ? trimmed : `${trimmed} FORMAT JSON`;

  const res = await fetch(url, { method: "POST", body });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ClickHouse error (${res.status}): ${text.slice(0, 500)}`);
  }
  if (hasFormat) {
    // Caller supplied their own FORMAT (e.g. JSONEachRow for dumpAll) — hand back raw text as a single row.
    return { columns: [], rows: [text] };
  }
  if (!isRead || !text.trim()) {
    // DDL/DML has no tabular output to parse.
    return { columns: [], rows: [] };
  }
  const parsed = JSON.parse(text) as { meta?: { name: string }[]; data?: unknown[] };
  return { columns: (parsed.meta ?? []).map((m) => m.name), rows: parsed.data ?? [] };
}

/** Escapes a string for use as a single-quoted literal in a query built by string concatenation. */
function escapeLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const FILTER_OPS: Record<BrowseFilter["op"], string> = {
  "=": "=",
  "!=": "!=",
  ">": ">",
  "<": "<",
  ">=": ">=",
  "<=": "<=",
  contains: "LIKE",
};

/**
 * ClickHouse's HTTP interface has no real bind parameters (see getRowById
 * below), so filter values are escaped as string literals rather than
 * parameterized — same reasoning, same escapeLiteral helper.
 */
function buildWhere(filters: BrowseFilter[] | undefined): string {
  if (!filters || filters.length === 0) return "";
  const parts = filters.map((f) => {
    const sqlOp = FILTER_OPS[f.op];
    if (!sqlOp) {
      const err = new Error(`invalid filter operator: ${f.op}`);
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    const value = f.op === "contains" ? `%${f.value}%` : f.value;
    return `${quoteIdent(f.column)} ${sqlOp} ${escapeLiteral(value)}`;
  });
  return `WHERE ${parts.join(" AND ")}`;
}

export const clickhouseAdapter: BrowserAdapter = {
  async listObjects(connectionString): Promise<BrowseObject[]> {
    const { rows } = await query(
      connectionString,
      "SELECT name, total_rows FROM system.tables WHERE database = currentDatabase() ORDER BY name"
    );
    return rows.map((r) => {
      const row = r as { name: string; total_rows: string | null };
      return { name: row.name, approxRowCount: row.total_rows ? Number(row.total_rows) : null };
    });
  },

  async browseObject(connectionString, ref, limit, offset, filters): Promise<QueryResult> {
    const table = quoteIdent(ref.name);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const safeOffset = Math.max(Math.trunc(offset), 0);
    const where = buildWhere(filters);
    const { columns, rows } = await query(connectionString, `SELECT * FROM ${table} ${where} LIMIT ${safeLimit} OFFSET ${safeOffset}`);
    return { columns, rows, rowCount: rows.length };
  },

  async runQuery(connectionString, sql): Promise<QueryResult> {
    const { columns, rows } = await query(connectionString, sql);
    return { columns, rows, rowCount: rows.length };
  },

  // toString(...) makes this work regardless of the id column's real type
  // (UInt32, String, UUID, ...) without needing to know it up front — a
  // real bind parameter isn't available over ClickHouse's HTTP interface,
  // so the value is escaped as a string literal instead (see escapeLiteral).
  // UPDATE/DELETE are deliberately not implemented here — see the
  // BrowserAdapter.updateRowById/deleteRowById doc comment.
  async getRowById(connectionString, table, idColumn, idValue): Promise<QueryResult> {
    const t = quoteIdent(table);
    const col = quoteIdent(idColumn);
    const { columns, rows } = await query(
      connectionString,
      `SELECT * FROM ${t} WHERE toString(${col}) = ${escapeLiteral(idValue)} LIMIT 1`
    );
    return { columns, rows, rowCount: rows.length };
  },

  async getSchemaContext(connectionString): Promise<string> {
    const { rows } = await query(
      connectionString,
      "SELECT table, name, type FROM system.columns WHERE database = currentDatabase() ORDER BY table, position LIMIT 2000"
    );
    const byTable = new Map<string, string[]>();
    for (const r of rows as { table: string; name: string; type: string }[]) {
      if (!byTable.has(r.table)) byTable.set(r.table, []);
      byTable.get(r.table)!.push(`${r.name} ${r.type}`);
    }
    const lines = [...byTable.entries()].slice(0, 60).map(([table, cols]) => `${table}(${cols.slice(0, 40).join(", ")})`);
    return lines.length > 0 ? lines.join("\n") : "(no tables found)";
  },

  /**
   * JSONEachRow — one JSON object per line — is one of ClickHouse's oldest,
   * most stable I/O formats, symmetric for both directions (SELECT ... FORMAT
   * JSONEachRow to dump, INSERT INTO ... FORMAT JSONEachRow to restore), which
   * is exactly why it was picked over the exec/shell approach in the manifest.
   */
  async dumpAll(connectionString): Promise<Buffer> {
    const { rows: tableRows } = await query(
      connectionString,
      "SELECT name FROM system.tables WHERE database = currentDatabase() ORDER BY name"
    );
    const tables = (tableRows as { name: string }[]).map((r) => r.name);
    const bundle: { table: string; ddl: string; rows: string }[] = [];
    for (const table of tables) {
      // Schema, not just row data — restoring into a database where the table
      // was dropped (the actual "recover from data loss" case) needs both.
      const { rows: ddlRows } = await query(connectionString, `SHOW CREATE TABLE ${quoteIdent(table)}`);
      const ddl = (ddlRows[0] as { statement: string }).statement;
      const { rows } = await query(connectionString, `SELECT * FROM ${quoteIdent(table)} FORMAT JSONEachRow`);
      bundle.push({ table, ddl, rows: rows[0] as string });
    }
    return Buffer.from(JSON.stringify({ format: "wharf-clickhouse-dump-v2", tables: bundle }), "utf8");
  },

  async importRows(connectionString, target, rows): Promise<{ inserted: number }> {
    if (rows.length === 0) return { inserted: 0 };
    const { origin, user, password, database } = parseConnection(connectionString);
    const body = rows.map((r) => JSON.stringify(r)).join("\n");
    const url = `${origin}/?database=${encodeURIComponent(database)}&user=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}&query=${encodeURIComponent(
      `INSERT INTO ${quoteIdent(target)} FORMAT JSONEachRow`
    )}`;
    const res = await fetch(url, { method: "POST", body });
    if (!res.ok) {
      throw new Error(`import failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    }
    return { inserted: rows.length };
  },

  async seedSampleData(connectionString): Promise<void> {
    await query(
      connectionString,
      "CREATE TABLE customers (id UInt32, name String, email String, created_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY id"
    );
    await query(
      connectionString,
      "CREATE TABLE orders (id UInt32, customer_id UInt32, item String, amount_cents UInt32, created_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY id"
    );
    await query(
      connectionString,
      `INSERT INTO customers (id, name, email) VALUES
        (1, 'Ada Lovelace', 'ada@example.com'),
        (2, 'Grace Hopper', 'grace@example.com'),
        (3, 'Alan Turing', 'alan@example.com')`
    );
    await query(
      connectionString,
      `INSERT INTO orders (id, customer_id, item, amount_cents) VALUES
        (1, 1, 'Widget', 1999),
        (2, 2, 'Gadget', 4999),
        (3, 3, 'Gizmo', 2999)`
    );
  },

  async restoreAll(connectionString, data): Promise<void> {
    const parsed = JSON.parse(data.toString("utf8")) as {
      format?: string;
      tables: { table: string; ddl: string; rows: string }[];
    };
    if (parsed.format !== "wharf-clickhouse-dump-v2") {
      throw new Error("this backup wasn't produced by Wharf's ClickHouse dump — refusing to restore it");
    }
    const { origin, user, password, database } = parseConnection(connectionString);
    for (const { table, ddl, rows } of parsed.tables) {
      // Idempotent: a no-op if the table still exists, recreates it if it
      // (or the whole database) was dropped since the backup was taken.
      await query(connectionString, ddl.replace(/^CREATE TABLE /i, "CREATE TABLE IF NOT EXISTS "));

      if (!rows.trim()) continue;
      const url = `${origin}/?database=${encodeURIComponent(database)}&user=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}&query=${encodeURIComponent(
        `INSERT INTO ${quoteIdent(table)} FORMAT JSONEachRow`
      )}`;
      const res = await fetch(url, { method: "POST", body: rows });
      if (!res.ok) {
        throw new Error(`restoring ${table} failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
      }
    }
  },
};
