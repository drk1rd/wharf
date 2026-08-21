import { Router, type Response } from "express";
import { instancesRepo, type InstanceRow } from "../db.js";
import { listManifests } from "../manifests/registry.js";
import { connectionInfo, createInstance, deleteInstance, requireOwnedInstance, requireRunningInstance, resizeInstance } from "../instances.js";
import { getContainerLogs, getContainerStats } from "../docker.js";
import { backupSupported, createBackup, getBackupSchedule, listBackups, restoreBackup, setBackupSchedule } from "../backups.js";
import { listApiTokens, mintApiToken, ownerIdFor, requireWriteAccess, revokeApiToken } from "../auth.js";

export const instancesRouter = Router();

/** Every route below catches its own errors locally rather than falling through to app.ts's global handler — so this is the only place an unexpected (5xx) failure gets logged server-side. Without it, a bug here is invisible outside of the JSON body the client happens to print. */
function respondError(res: Response, err: unknown): void {
  const status = (err as Error & { status?: number }).status ?? 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

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
    backupSchedule: toPublicSchedule(getBackupSchedule(row.id)),
  };
}

function toPublicSchedule(schedule: ReturnType<typeof getBackupSchedule>) {
  if (!schedule) return null;
  return { intervalHours: schedule.interval_hours, retentionCount: schedule.retention_count, lastRunAt: schedule.last_run_at };
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
  // A scoped token only ever sees the one instance it's bound to — never
  // the full list a "list all" call would otherwise return.
  const rows: InstanceRow[] =
    auth.kind === "user"
      ? instancesRepo.listForOwner(auth.userId)
      : auth.kind === "scoped"
        ? [instancesRepo.get(auth.instanceId)].filter((r): r is InstanceRow => Boolean(r))
        : instancesRepo.list();
  res.json(rows.map(publicInstance));
});

instancesRouter.post("/instances", async (req, res) => {
  if (req.auth!.kind === "scoped") {
    res.status(403).json({ error: "a scoped token can't create new instances — it's bound to the one it was minted for" });
    return;
  }
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
    respondError(res, err);
  }
});

instancesRouter.delete("/instances/:id", async (req, res) => {
  try {
    requireWriteAccess(req.auth!);
    await deleteInstance(req.params.id, req.auth!);
    res.status(204).end();
  } catch (err) {
    respondError(res, err);
  }
});

instancesRouter.patch("/instances/:id/resize", async (req, res) => {
  try {
    requireWriteAccess(req.auth!);
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
    respondError(res, err);
  }
});

instancesRouter.get("/instances/:id/metrics", async (req, res) => {
  try {
    const row = requireRunningInstance(req.params.id, req.auth!);
    const stats = await getContainerStats(row.container_id as string);
    res.json(stats);
  } catch (err) {
    respondError(res, err);
  }
});

instancesRouter.get("/instances/:id/logs", async (req, res) => {
  try {
    const row = requireRunningInstance(req.params.id, req.auth!);
    const tail = Number(req.query.tail ?? 300);
    const text = await getContainerLogs(row.container_id as string, Number.isFinite(tail) ? tail : 300);
    res.type("text/plain").send(text);
  } catch (err) {
    respondError(res, err);
  }
});

instancesRouter.post("/instances/:id/backups", async (req, res) => {
  try {
    requireWriteAccess(req.auth!);
    const row = requireRunningInstance(req.params.id, req.auth!);
    const backup = await createBackup(row);
    res.status(201).json(backup);
  } catch (err) {
    respondError(res, err);
  }
});

instancesRouter.get("/instances/:id/backups", (req, res) => {
  try {
    requireOwnedInstance(req.params.id, req.auth!);
    res.json(listBackups(req.params.id));
  } catch (err) {
    respondError(res, err);
  }
});

instancesRouter.patch("/instances/:id/backup-schedule", async (req, res) => {
  try {
    requireWriteAccess(req.auth!);
    requireOwnedInstance(req.params.id, req.auth!);
    const { intervalHours, retentionCount } = req.body ?? {};
    if (intervalHours !== null && typeof intervalHours !== "number") {
      res.status(400).json({ error: "intervalHours must be a number, or null to disable" });
      return;
    }
    if (intervalHours !== null && typeof retentionCount !== "number") {
      res.status(400).json({ error: "retentionCount is required when enabling a schedule" });
      return;
    }
    const schedule = setBackupSchedule(req.params.id, intervalHours, retentionCount ?? 0);
    res.json(toPublicSchedule(schedule));
  } catch (err) {
    respondError(res, err);
  }
});

instancesRouter.post("/instances/:id/restore", async (req, res) => {
  try {
    requireWriteAccess(req.auth!);
    const row = requireRunningInstance(req.params.id, req.auth!);
    const { backupId } = req.body ?? {};
    if (typeof backupId !== "string") {
      res.status(400).json({ error: "backupId is required" });
      return;
    }
    await restoreBackup(row, backupId);
    res.status(204).end();
  } catch (err) {
    respondError(res, err);
  }
});

// Token minting/listing/revocation is deliberately unavailable to a scoped
// token itself — requireOwnedInstance lets it through (it can access its own
// instance), so each handler below checks `kind === "scoped"` explicitly: a
// leaked read-only token must never be usable to mint itself a replacement.
instancesRouter.post("/instances/:id/tokens", (req, res) => {
  try {
    const row = requireOwnedInstance(req.params.id, req.auth!);
    if (req.auth!.kind === "scoped") {
      res.status(403).json({ error: "a scoped token can't mint another token" });
      return;
    }
    const { scope, name } = req.body ?? {};
    if (scope !== "read" && scope !== "write") {
      res.status(400).json({ error: 'scope must be "read" or "write"' });
      return;
    }
    const { token, row: tokenRow } = mintApiToken(row.id, scope, typeof name === "string" && name.trim() ? name.trim() : null);
    res.status(201).json({
      // The only time the plaintext token is ever returned — only its hash
      // is stored, so this response is the caller's one chance to see it.
      token,
      id: tokenRow.id,
      scope: tokenRow.scope,
      name: tokenRow.name,
      createdAt: tokenRow.created_at,
    });
  } catch (err) {
    respondError(res, err);
  }
});

instancesRouter.get("/instances/:id/tokens", (req, res) => {
  try {
    requireOwnedInstance(req.params.id, req.auth!);
    if (req.auth!.kind === "scoped") {
      res.status(403).json({ error: "a scoped token can't list tokens for its own instance" });
      return;
    }
    res.json(
      listApiTokens(req.params.id).map((t) => ({
        id: t.id,
        scope: t.scope,
        name: t.name,
        createdAt: t.created_at,
        lastUsedAt: t.last_used_at,
      }))
    );
  } catch (err) {
    respondError(res, err);
  }
});

instancesRouter.delete("/instances/:id/tokens/:tokenId", (req, res) => {
  try {
    requireOwnedInstance(req.params.id, req.auth!);
    if (req.auth!.kind === "scoped") {
      res.status(403).json({ error: "a scoped token can't revoke tokens for its own instance" });
      return;
    }
    revokeApiToken(req.params.tokenId, req.params.id);
    res.status(204).end();
  } catch (err) {
    respondError(res, err);
  }
});
