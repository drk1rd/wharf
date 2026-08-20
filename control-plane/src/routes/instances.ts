import { Router } from "express";
import { instancesRepo } from "../db.js";
import { listManifests } from "../manifests/registry.js";
import { connectionInfo, createInstance, deleteInstance, requireOwnedInstance, requireRunningInstance, resizeInstance } from "../instances.js";
import { getContainerLogs, getContainerStats } from "../docker.js";
import { backupSupported, createBackup, listBackups, restoreBackup } from "../backups.js";
import { ownerIdFor } from "../auth.js";

export const instancesRouter = Router();

function publicInstance(row: ReturnType<typeof instancesRepo.get>) {
  if (!row) return null;
  const conn = connectionInfo(row);
  return {
    id: row.id,
    name: row.name,
    engine: row.engine,
    version: row.version,
    status: row.status,
    createdAt: row.created_at,
    error: row.error,
    resources: { cpu: row.cpu, memoryMb: row.memory_mb, diskGb: row.disk_gb },
    connection: conn,
    backupSupported: backupSupported(row.engine),
  };
}

instancesRouter.get("/engines", (_req, res) => {
  res.json(
    listManifests().map((m) => ({
      id: m.id,
      displayName: m.displayName,
      versions: m.versions,
      defaultVersion: m.defaultVersion,
    }))
  );
});

instancesRouter.get("/instances", (req, res) => {
  const auth = req.auth!;
  const rows = auth.kind === "user" ? instancesRepo.listForOwner(auth.userId) : instancesRepo.list();
  res.json(rows.map(publicInstance));
});

instancesRouter.post("/instances", async (req, res) => {
  const { name, engine, version } = req.body ?? {};
  if (typeof engine !== "string") {
    res.status(400).json({ error: "engine is required" });
    return;
  }
  try {
    const row = await createInstance(
      typeof name === "string" && name.trim() ? name.trim() : `${engine}-${Date.now()}`,
      engine,
      ownerIdFor(req.auth!),
      version
    );
    res.status(201).json(publicInstance(row));
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 400;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

instancesRouter.get("/instances/:id", (req, res) => {
  try {
    const row = requireOwnedInstance(req.params.id, req.auth!);
    res.json(publicInstance(row));
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

instancesRouter.delete("/instances/:id", async (req, res) => {
  try {
    await deleteInstance(req.params.id, req.auth!);
    res.status(204).end();
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

instancesRouter.patch("/instances/:id/resize", async (req, res) => {
  try {
    const { cpu, memoryMb } = req.body ?? {};
    if (cpu !== undefined && typeof cpu !== "string") {
      res.status(400).json({ error: "cpu must be a string like \"1\" or \"0.5\"" });
      return;
    }
    if (memoryMb !== undefined && typeof memoryMb !== "number") {
      res.status(400).json({ error: "memoryMb must be a number" });
      return;
    }
    const row = await resizeInstance(req.params.id, req.auth!, { cpu, memoryMb });
    res.json(publicInstance(row));
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

instancesRouter.get("/instances/:id/metrics", async (req, res) => {
  try {
    const row = requireRunningInstance(req.params.id, req.auth!);
    const stats = await getContainerStats(row.container_id as string);
    res.json(stats);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

instancesRouter.get("/instances/:id/logs", async (req, res) => {
  try {
    const row = requireRunningInstance(req.params.id, req.auth!);
    const tail = Number(req.query.tail ?? 300);
    const text = await getContainerLogs(row.container_id as string, Number.isFinite(tail) ? tail : 300);
    res.type("text/plain").send(text);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

instancesRouter.post("/instances/:id/backups", async (req, res) => {
  try {
    const row = requireRunningInstance(req.params.id, req.auth!);
    const backup = await createBackup(row);
    res.status(201).json(backup);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

instancesRouter.get("/instances/:id/backups", (req, res) => {
  try {
    requireOwnedInstance(req.params.id, req.auth!);
    res.json(listBackups(req.params.id));
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

instancesRouter.post("/instances/:id/restore", async (req, res) => {
  try {
    const row = requireRunningInstance(req.params.id, req.auth!);
    const { backupId } = req.body ?? {};
    if (typeof backupId !== "string") {
      res.status(400).json({ error: "backupId is required" });
      return;
    }
    await restoreBackup(row, backupId);
    res.status(204).end();
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
