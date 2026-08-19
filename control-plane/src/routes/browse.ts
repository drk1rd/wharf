import { Router } from "express";
import { internalConnectionString, requireRunningInstance } from "../instances.js";
import { getBrowserAdapter } from "../browser/registry.js";
import { getManifest } from "../manifests/registry.js";

export const browseRouter = Router();

function adapterFor(instanceId: string) {
  const row = requireRunningInstance(instanceId);
  const manifest = getManifest(row.engine);
  if (!manifest) throw new Error(`unknown engine: ${row.engine}`);
  const connectionString = internalConnectionString(row);
  if (!connectionString) throw new Error("instance has no connection info yet");
  return { adapter: getBrowserAdapter(manifest.browserAdapter), connectionString };
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
