import { Router, type Response } from "express";
import { internalConnectionString, requireRunningInstance } from "../instances.js";
import { getBrowserAdapter } from "../browser/registry.js";
import { getManifest } from "../manifests/registry.js";
import { requireWriteAccess, type AuthContext } from "../auth.js";
import { recordAudit } from "../audit.js";

export const tableApiRouter = Router();

function respondError(res: Response, err: unknown): void {
  const status = (err as Error & { status?: number }).status ?? 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

function badRequest(message: string): never {
  const err = new Error(message);
  (err as Error & { status?: number }).status = 400;
  throw err;
}

// Auto-generated per-table REST API is only offered for SQL engines with a
// real notion of "a table" — the same engine gate ask-your-data already uses
// in routes/browse.ts. MongoDB/Redis don't have tables in this sense.
const SUPPORTED_ENGINES = new Set(["postgres", "mysql", "clickhouse"]);

async function tableFor(instanceId: string, auth: AuthContext, table: string) {
  const row = requireRunningInstance(instanceId, auth);
  const manifest = getManifest(row.engine);
  if (!manifest) throw new Error(`unknown engine: ${row.engine}`);
  if (!SUPPORTED_ENGINES.has(row.engine)) {
    badRequest(
      `the auto-generated table API isn't available for ${manifest.displayName} — it only supports SQL engines with tables (postgres, mysql, clickhouse)`
    );
  }
  const connectionString = internalConnectionString(row);
  if (!connectionString) throw new Error("instance has no connection info yet");
  const adapter = getBrowserAdapter(manifest.browserAdapter);

  // Validated against the real table list rather than trusting the URL
  // segment outright — a thin, safe wrapper around each adapter's existing
  // query building, not a new query engine of its own.
  const objects = await adapter.listObjects(connectionString);
  if (!objects.some((o) => o.name === table)) {
    const err = new Error(`table "${table}" not found on this instance`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  return { adapter, connectionString, engine: row.engine };
}

/**
 * Tables have no guaranteed single well-known primary-key column across
 * postgres/mysql/clickhouse (ClickHouse's MergeTree "primary key" is a
 * sort/index key, not a uniqueness constraint — plenty of tables have none
 * at all), so single-row operations require the caller to say which column
 * to filter by rather than assuming one named "id" exists — it just
 * defaults to "id" for the common case.
 */
function idColumnFrom(req: { query: Record<string, unknown> }): string {
  const raw = req.query.idColumn;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "id";
}

tableApiRouter.get("/instances/:id/api/:table", async (req, res) => {
  try {
    const { adapter, connectionString } = await tableFor(req.params.id, req.auth!, req.params.table);
    const limit = Number(req.query.limit ?? 100);
    const offset = Number(req.query.offset ?? 0);
    const result = await adapter.browseObject(
      connectionString,
      { name: req.params.table },
      Number.isFinite(limit) ? limit : 100,
      Number.isFinite(offset) ? offset : 0
    );
    res.json(result);
  } catch (err) {
    respondError(res, err);
  }
});

tableApiRouter.get("/instances/:id/api/:table/:rowId", async (req, res) => {
  try {
    const { adapter, connectionString, engine } = await tableFor(req.params.id, req.auth!, req.params.table);
    if (!adapter.getRowById) {
      res.status(400).json({ error: `single-row lookup isn't supported for ${engine} yet` });
      return;
    }
    const idColumn = idColumnFrom(req);
    const result = await adapter.getRowById(connectionString, req.params.table, idColumn, req.params.rowId);
    if (result.rows.length === 0) {
      res.status(404).json({ error: `no row found where ${idColumn} = ${req.params.rowId}` });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    respondError(res, err);
  }
});

tableApiRouter.post("/instances/:id/api/:table", async (req, res) => {
  try {
    requireWriteAccess(req.auth!);
    const { adapter, connectionString } = await tableFor(req.params.id, req.auth!, req.params.table);
    if (!adapter.importRows) {
      res.status(400).json({ error: "insert isn't supported for this engine yet" });
      return;
    }
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      res.status(400).json({ error: "request body must be a JSON object of column: value pairs" });
      return;
    }
    const result = await adapter.importRows(connectionString, req.params.table, [body as Record<string, unknown>]);
    recordAudit(req.params.id, req.auth!, "api.insert", `table=${req.params.table}`);
    res.status(201).json({ inserted: result.inserted });
  } catch (err) {
    respondError(res, err);
  }
});

tableApiRouter.patch("/instances/:id/api/:table/:rowId", async (req, res) => {
  try {
    requireWriteAccess(req.auth!);
    const { adapter, connectionString, engine } = await tableFor(req.params.id, req.auth!, req.params.table);
    if (!adapter.updateRowById) {
      res.status(400).json({ error: `row update isn't supported for ${engine} yet` });
      return;
    }
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length === 0) {
      res.status(400).json({ error: "request body must be a non-empty JSON object of column: value pairs to update" });
      return;
    }
    const idColumn = idColumnFrom(req);
    const result = await adapter.updateRowById(
      connectionString,
      req.params.table,
      idColumn,
      req.params.rowId,
      body as Record<string, unknown>
    );
    if (result.updated === 0) {
      res.status(404).json({ error: `no row found where ${idColumn} = ${req.params.rowId}` });
      return;
    }
    recordAudit(req.params.id, req.auth!, "api.update", `table=${req.params.table} ${idColumn}=${req.params.rowId}`);
    res.json({ updated: result.updated });
  } catch (err) {
    respondError(res, err);
  }
});

tableApiRouter.delete("/instances/:id/api/:table/:rowId", async (req, res) => {
  try {
    requireWriteAccess(req.auth!);
    const { adapter, connectionString, engine } = await tableFor(req.params.id, req.auth!, req.params.table);
    if (!adapter.deleteRowById) {
      res.status(400).json({ error: `row delete isn't supported for ${engine} yet` });
      return;
    }
    const idColumn = idColumnFrom(req);
    const result = await adapter.deleteRowById(connectionString, req.params.table, idColumn, req.params.rowId);
    if (result.deleted === 0) {
      res.status(404).json({ error: `no row found where ${idColumn} = ${req.params.rowId}` });
      return;
    }
    recordAudit(req.params.id, req.auth!, "api.delete", `table=${req.params.table} ${idColumn}=${req.params.rowId}`);
    res.status(204).end();
  } catch (err) {
    respondError(res, err);
  }
});
