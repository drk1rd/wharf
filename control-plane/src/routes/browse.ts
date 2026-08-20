import { Router } from "express";
import { internalConnectionString, requireRunningInstance } from "../instances.js";
import { getBrowserAdapter } from "../browser/registry.js";
import { getManifest } from "../manifests/registry.js";
import { askEnabled, generateQuery } from "../ask.js";

export const browseRouter = Router();

function adapterFor(instanceId: string) {
  const row = requireRunningInstance(instanceId);
  const manifest = getManifest(row.engine);
  if (!manifest) throw new Error(`unknown engine: ${row.engine}`);
  const connectionString = internalConnectionString(row);
  if (!connectionString) throw new Error("instance has no connection info yet");
  return { adapter: getBrowserAdapter(manifest.browserAdapter), connectionString, engine: row.engine };
}

browseRouter.get("/instances/:id/browse/objects", async (req, res) => {
  try {
    const { adapter, connectionString } = adapterFor(req.params.id);
    res.json(await adapter.listObjects(connectionString));
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

browseRouter.get("/instances/:id/browse/objects/:name/rows", async (req, res) => {
  try {
    const { adapter, connectionString } = adapterFor(req.params.id);
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
    const { adapter, connectionString } = adapterFor(req.params.id);
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

browseRouter.post("/instances/:id/ask", async (req, res) => {
  try {
    if (!askEnabled()) {
      res.status(501).json({ error: "ANTHROPIC_API_KEY is not set on the control plane — ask-your-data is disabled" });
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

    const { adapter, connectionString, engine } = adapterFor(req.params.id);
    if (engine !== "postgres" && engine !== "mongodb") {
      throw new Error(`ask-your-data is not supported for engine: ${engine}`);
    }

    const schemaContext = await adapter.getSchemaContext(connectionString);
    const generated = await generateQuery(engine, schemaContext, question);
    const result = await adapter.runQuery(connectionString, generated.query);
    res.json({ query: generated.query, explanation: generated.explanation, result });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
