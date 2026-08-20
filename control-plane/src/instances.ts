import { randomUUID } from "node:crypto";
import { instancesRepo, type InstanceRow } from "./db.js";
import { getManifest } from "./manifests/registry.js";
import type { InstanceSecrets, ServiceManifest } from "./manifests/types.js";
import { createInstanceContainer, stopAndRemoveContainer, updateContainerResources, waitForPort } from "./docker.js";
import { canAccessInstance, type AuthContext } from "./auth.js";
import { getBrowserAdapter } from "./browser/registry.js";

// The host used in connection strings handed to users/clients — wherever the
// docker daemon's published ports are actually reachable from (typically the
// machine running `docker compose up`).
const PUBLIC_HOST = process.env.WHARF_PUBLIC_HOST ?? "localhost";

// The host the control plane itself uses to probe a freshly-created instance
// for readiness. When the control plane runs inside its own container (the
// self-host docker-compose setup) it can't reach sibling containers' published
// ports via "localhost" — it needs the docker host gateway instead. Defaults
// to PUBLIC_HOST for the common "control plane runs on bare metal/dev machine"
// case, where they're the same thing.
const PROBE_HOST = process.env.WHARF_PROBE_HOST ?? PUBLIC_HOST;

export function instanceHost(): string {
  return PUBLIC_HOST;
}

export function connectionInfo(row: InstanceRow): { host: string; port: number; connectionString: string } | null {
  const manifest = getManifest(row.engine);
  if (!manifest || !row.host_port || !row.username || !row.password || !row.database_name) return null;
  const secrets: InstanceSecrets = { username: row.username, password: row.password, database: row.database_name };
  return {
    host: PUBLIC_HOST,
    port: row.host_port,
    connectionString: manifest.connectionString(secrets, PUBLIC_HOST, row.host_port),
  };
}

/**
 * Connection string built with PROBE_HOST instead of PUBLIC_HOST — for the
 * control plane's own outbound queries (the data browser), which need to
 * reach the instance the same way the readiness probe does, not the way an
 * end user's browser/CLI does.
 */
export function internalConnectionString(row: InstanceRow): string | null {
  const manifest = getManifest(row.engine);
  if (!manifest || !row.host_port || !row.username || !row.password || !row.database_name) return null;
  const secrets: InstanceSecrets = { username: row.username, password: row.password, database: row.database_name };
  return manifest.connectionString(secrets, PROBE_HOST, row.host_port);
}

// Protects a shared host (e.g. a small pilot everyone points at) from one
// person spinning up far more instances than the box can hold. 0 or unset
// disables the cap — fine for a single-user local/dev setup.
const MAX_INSTANCES = Number(process.env.WHARF_MAX_INSTANCES ?? 0);

export async function createInstance(name: string, engine: string, ownerId: string | null, version?: string): Promise<InstanceRow> {
  if (MAX_INSTANCES > 0 && instancesRepo.list().length >= MAX_INSTANCES) {
    const err = new Error(`this Wharf instance is at its limit of ${MAX_INSTANCES} databases — delete one before creating another`);
    (err as Error & { status?: number }).status = 429;
    throw err;
  }

  const manifest = getManifest(engine);
  if (!manifest) throw new Error(`unknown engine: ${engine}`);
  const resolvedVersion = version && manifest.versions.includes(version) ? version : manifest.defaultVersion;

  const id = randomUUID();
  const secrets = manifest.makeSecrets(id);
  const row: InstanceRow = {
    id,
    owner_id: ownerId,
    name,
    engine,
    version: resolvedVersion,
    status: "creating",
    container_id: null,
    volume_name: null,
    host_port: null,
    username: secrets.username,
    password: secrets.password,
    database_name: secrets.database,
    cpu: manifest.resourceDefaults.cpu,
    memory_mb: manifest.resourceDefaults.memoryMb,
    disk_gb: manifest.resourceDefaults.diskGb,
    created_at: new Date().toISOString(),
    error: null,
  };
  instancesRepo.insert(row);

  // Provision in the background — the client polls GET /api/instances/:id for status.
  void provision(id, manifest, resolvedVersion, secrets);

  return row;
}

/**
 * A bare TCP connect is not enough to call an engine ready — Postgres and
 * MySQL's official images both do an initdb-then-restart startup sequence
 * where the port accepts a TCP connection slightly before the server can
 * actually serve a query (CI caught this for real: both failed their first
 * post-"running" query with a real Postgres/MySQL container, while MongoDB
 * and Redis — no such restart cycle — didn't). So "running" now means the
 * browser adapter can actually complete a real call, not just that the port
 * is open.
 */
async function waitForAdapterReady(
  browserAdapter: ServiceManifest["browserAdapter"],
  connectionString: string,
  timeoutMs = 30000
): Promise<void> {
  const adapter = getBrowserAdapter(browserAdapter);
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await adapter.listObjects(connectionString);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("engine did not become query-ready in time");
}

async function provision(id: string, manifest: ServiceManifest, version: string, secrets: InstanceSecrets): Promise<void> {
  try {
    const { containerId, volumeName, hostPort } = await createInstanceContainer({
      instanceId: id,
      manifest,
      version,
      secrets,
    });
    instancesRepo.update(id, { container_id: containerId, volume_name: volumeName, host_port: hostPort });

    const tcpReady = await waitForPort(PROBE_HOST, hostPort);
    if (!tcpReady) throw new Error("engine did not become reachable in time");

    const connectionString = manifest.connectionString(secrets, PROBE_HOST, hostPort);
    await waitForAdapterReady(manifest.browserAdapter, connectionString);

    instancesRepo.update(id, { status: "running" });
  } catch (err) {
    instancesRepo.update(id, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteInstance(id: string, auth: AuthContext): Promise<boolean> {
  const row = requireOwnedInstance(id, auth);
  if (row.container_id) {
    await stopAndRemoveContainer(row.container_id, row.volume_name ?? undefined);
  }
  instancesRepo.remove(id);
  return true;
}

function badRequest(message: string): never {
  const err = new Error(message);
  (err as Error & { status?: number }).status = 400;
  throw err;
}

/**
 * Live CPU/memory resize — no restart, no recreation, takes effect immediately
 * via the container's cgroup limits. Disk isn't resizable this way (a Docker
 * volume can't be live-grown without a migration), so it's deliberately not
 * part of this — see PLAN.md.
 */
export async function resizeInstance(id: string, auth: AuthContext, opts: { cpu?: string; memoryMb?: number }): Promise<InstanceRow> {
  const row = requireRunningInstance(id, auth);

  if (opts.cpu !== undefined) {
    const cpu = parseFloat(opts.cpu);
    if (!Number.isFinite(cpu) || cpu < 0.1 || cpu > 16) {
      badRequest("cpu must be a number between 0.1 and 16 (cores)");
    }
  }
  if (opts.memoryMb !== undefined) {
    if (!Number.isFinite(opts.memoryMb) || opts.memoryMb < 128 || opts.memoryMb > 32768) {
      badRequest("memoryMb must be between 128 and 32768");
    }
  }
  if (opts.cpu === undefined && opts.memoryMb === undefined) {
    badRequest("provide cpu and/or memoryMb to resize");
  }

  await updateContainerResources(row.container_id as string, opts);
  instancesRepo.update(id, {
    ...(opts.cpu !== undefined ? { cpu: opts.cpu } : {}),
    ...(opts.memoryMb !== undefined ? { memory_mb: opts.memoryMb } : {}),
  });
  return instancesRepo.get(id)!;
}

function notFound(): never {
  const err = new Error("instance not found");
  (err as Error & { status?: number }).status = 404;
  throw err;
}

/** Fetches an instance and checks the caller is allowed to see it — 404 either way, so existence isn't leaked to someone who doesn't own it. */
export function requireOwnedInstance(id: string, auth: AuthContext): InstanceRow {
  const row = instancesRepo.get(id);
  if (!row || !canAccessInstance(row, auth)) notFound();
  return row;
}

export function requireRunningInstance(id: string, auth: AuthContext): InstanceRow {
  const row = requireOwnedInstance(id, auth);
  if (row.status !== "running" || !row.container_id) {
    const err = new Error(`instance is not running (status: ${row.status})`);
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  return row;
}
