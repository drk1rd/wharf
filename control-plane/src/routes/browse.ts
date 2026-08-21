import { Router } from "express";
import { internalConnectionString, requireRunningInstance } from "../instances.js";
import { getBrowserAdapter } from "../browser/registry.js";
import { getManifest } from "../manifests/registry.js";
import { askEnabled, generateQuery, listModels } from "../ask.js";
import { usersRepo } from "../db.js";
import { parseCsv, parseJsonRows } from "../import.js";
import type { AuthContext } from "../auth.js";

export const browseRouter = Router();

function adapterFor(instanceId: string, auth: AuthContext) {
  const row = requireRunningInstance(instanceId, auth);
  const manifest = getManifest(row.engine);
  if (!manifest) throw new Error(`unknown engine: ${row.engine}`);
  const connectionString = internalConnectionString(row);
  if (!connectionString) throw new Error("instance has no connection info yet");
  return { adapter: getBrowserAdapter(manifest.browserAdapter), connectionString, engine: row.engine };
}

browseRouter.get("/instances/:id/browse/objects", async (req, res) => {
  try {
    const { adapter, connectionString } = adapterFor(req.params.id, req.auth!);
    res.json(await adapter.listObjects(connectionString));
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

browseRouter.get("/instances/:id/browse/objects/:name/rows", async (req, res) => {
  try {
    const { adapter, connectionString } = adapterFor(req.params.id, req.auth!);
    const limit = Number(req.query.limit ?? 100);
    const offset = Number(req.query.offset ?? 0);
    const schema = typeof req.query.schema === "string" ? req.query.schema : undefined;
    const result = await adapter.browseObject(
      connectionString,
      { name: req.params.name, schema },
      Number.isFinite(limit) ? limit : 100,
      Number.isFinite(offset) ? offset : 0
    );
    res.json(result);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

browseRouter.post("/instances/:id/browse/query", async (req, res) => {
  try {
    const { adapter, connectionString } = adapterFor(req.params.id, req.auth!);
    const { query } = req.body ?? {};
    if (typeof query !== "string" || !query.trim()) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    res.json(await adapter.runQuery(connectionString, query));
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

browseRouter.post("/instances/:id/browse/import", async (req, res) => {
  try {
    const { adapter, connectionString, engine } = adapterFor(req.params.id, req.auth!);
    if (!adapter.importRows) {
      res.status(400).json({ error: `import isn't supported for ${engine} yet` });
      return;
    }
    const { format, data } = req.body ?? {};
    let { target } = req.body ?? {};
    if (typeof data !== "string" || !data.trim()) {
      res.status(400).json({ error: "data is required" });
      return;
    }
    if (format !== "csv" && format !== "json") {
      res.status(400).json({ error: 'format must be "csv" or "json"' });
      return;
    }
    if (engine === "redis") {
      // No table/collection concept — target is unused, but importRows still needs a string.
      target = target ?? "";
    } else if (typeof target !== "string" || !target.trim()) {
      res.status(400).json({ error: "target (table/collection name) is required" });
      return;
    }

    const rows = format === "csv" ? parseCsv(data) : parseJsonRows(data);
    if (rows.length === 0) {
      res.json({ inserted: 0 });
      return;
    }
    const result = await adapter.importRows(connectionString, target, rows);
    res.status(201).json(result);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 400;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

browseRouter.get("/models", async (_req, res) => {
  try {
    res.json(await listModels());
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

browseRouter.post("/instances/:id/ask", async (req, res) => {
  try {
    if (!askEnabled()) {
      res.status(501).json({ error: "OPENROUTER_API_KEY is not set on the control plane — ask-your-data is disabled" });
      return;
    }
    const { question } = req.body ?? {};
    if (typeof question !== "string" || !question.trim()) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    if (question.length > 2000) {
      res.status(400).json({ error: "question is too long" });
      return;
    }

    let model = typeof req.body?.model === "string" ? req.body.model : undefined;
    if (!model && req.auth!.kind === "user") {
      model = usersRepo.getById(req.auth!.userId)?.default_model ?? undefined;
    }
    if (!model) {
      res.status(400).json({ error: "no model selected — pick one in Settings, or pass one with this request" });
      return;
    }

    const { adapter, connectionString, engine } = adapterFor(req.params.id, req.auth!);
    if (engine !== "postgres" && engine !== "mongodb" && engine !== "mysql" && engine !== "clickhouse") {
      res.status(400).json({ error: `ask-your-data isn't available for ${engine} yet — key-value stores don't map cleanly to a single generated query` });
      return;
    }

    const schemaContext = await adapter.getSchemaContext(connectionString);
    const generated = await generateQuery(model, engine, schemaContext, question);
    const result = await adapter.runQuery(connectionString, generated.query);
    res.json({ query: generated.query, explanation: generated.explanation, result, model });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
