import { randomUUID } from "node:crypto";
import { instancesRepo, apiTokensRepo, type InstanceRow } from "./db.js";
import { getManifest } from "./manifests/registry.js";
import type { InstanceSecrets, ServiceManifest } from "./manifests/types.js";
import { createInstanceContainer, stopAndRemoveContainer, updateContainerResources, waitForPort } from "./docker.js";
import { canAccessInstance, type AuthContext } from "./auth.js";
import { getBrowserAdapter } from "./browser/registry.js";
import { createBackup, deleteBackupsForInstance, restoreBackupInto } from "./backups.js";

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

// A handful of sample rows/documents/keys inserted right after a fresh
// instance becomes ready, so the data browser isn't empty on first look —
// set to "false" to disable (e.g. a shared/hosted deployment that would
// rather every instance start genuinely empty).
const SEED_SAMPLE_DATA = process.env.WHARF_SEED_SAMPLE_DATA !== "false";

// Instance count alone doesn't protect a shared host: live resize (below)
// lets any single instance grow up to 16 cores / 32GB with no ceiling of its
// own, so a handful of resizes can still starve the box even under a low
// count cap. These are the aggregate budget across every instance combined —
// each independently optional, 0/unset disables that one.
const MAX_TOTAL_CPU = Number(process.env.WHARF_MAX_TOTAL_CPU ?? 0);
const MAX_TOTAL_MEMORY_MB = Number(process.env.WHARF_MAX_TOTAL_MEMORY_MB ?? 0);

/** Sums cpu/memory currently reserved across every instance, excluding errored ones (no real allocation) and, optionally, one about to be resized (whose existing reservation is being replaced, not added to). */
function reservedResources(excludeId?: string): { cpu: number; memoryMb: number } {
  let cpu = 0;
  let memoryMb = 0;
  for (const row of instancesRepo.list()) {
    if (row.status === "error" || row.id === excludeId) continue;
    cpu += parseFloat(row.cpu);
    memoryMb += row.memory_mb;
  }
  return { cpu, memoryMb };
}

function assertWithinResourceBudget(requestedCpu: number, requestedMemoryMb: number, excludeId?: string): void {
  if (MAX_TOTAL_CPU <= 0 && MAX_TOTAL_MEMORY_MB <= 0) return;
  const reserved = reservedResources(excludeId);
  if (MAX_TOTAL_CPU > 0 && reserved.cpu + requestedCpu > MAX_TOTAL_CPU) {
    const err = new Error(
      `this would exceed the host's total CPU budget (${MAX_TOTAL_CPU} cores) — ${reserved.cpu} already reserved, ${requestedCpu} requested`
    );
    (err as Error & { status?: number }).status = 429;
    throw err;
  }
  if (MAX_TOTAL_MEMORY_MB > 0 && reserved.memoryMb + requestedMemoryMb > MAX_TOTAL_MEMORY_MB) {
    const err = new Error(
      `this would exceed the host's total memory budget (${MAX_TOTAL_MEMORY_MB} MB) — ${reserved.memoryMb} already reserved, ${requestedMemoryMb} requested`
    );
    (err as Error & { status?: number }).status = 429;
    throw err;
  }
}

export async function createInstance(
  name: string,
  engine: string,
  ownerId: string | null,
  version?: string,
  opts: { seed?: boolean } = {}
): Promise<InstanceRow> {
  if (MAX_INSTANCES > 0 && instancesRepo.list().length >= MAX_INSTANCES) {
    const err = new Error(`this Wharf instance is at its limit of ${MAX_INSTANCES} databases — delete one before creating another`);
    (err as Error & { status?: number }).status = 429;
    throw err;
  }

  const manifest = getManifest(engine);
  if (!manifest) throw new Error(`unknown engine: ${engine}`);
  const resolvedVersion = version && manifest.versions.includes(version) ? version : manifest.defaultVersion;

  assertWithinResourceBudget(parseFloat(manifest.resourceDefaults.cpu), manifest.resourceDefaults.memoryMb);

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
  void provision(id, manifest, resolvedVersion, secrets, opts.seed ?? true);

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

async function provision(id: string, manifest: ServiceManifest, version: string, secrets: InstanceSecrets, seed: boolean): Promise<void> {
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

    if (SEED_SAMPLE_DATA && seed) {
      // Best-effort: a fresh instance still counts as successfully provisioned
      // even if seeding fails for some reason — sample data is a convenience,
      // not something worth failing the whole instance over.
      await getBrowserAdapter(manifest.browserAdapter)
        .seedSampleData?.(connectionString)
        .catch(() => undefined);
    }

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
  await deleteBackupsForInstance(id);
  apiTokensRepo.removeForInstance(id);
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

  assertWithinResourceBudget(
    opts.cpu !== undefined ? parseFloat(opts.cpu) : parseFloat(row.cpu),
    opts.memoryMb !== undefined ? opts.memoryMb : row.memory_mb,
    id
  );

  await updateContainerResources(row.container_id as string, opts);
  instancesRepo.update(id, {
    ...(opts.cpu !== undefined ? { cpu: opts.cpu } : {}),
    ...(opts.memoryMb !== undefined ? { memory_mb: opts.memoryMb } : {}),
  });
  return instancesRepo.get(id)!;
}

/** Polls the DB until an instance settles — production use (createBranch, below), not just the test harness's own copy of this pattern. */
export async function waitForInstanceRunning(id: string, timeoutMs = 90_000): Promise<InstanceRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = instancesRepo.get(id);
    if (!row) throw new Error("instance disappeared while waiting for it to become ready");
    if (row.status === "running") return row;
    if (row.status === "error") throw new Error(`branch's new instance failed to provision: ${row.error}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("branch's new instance did not become ready in time");
}

/**
 * Clones a running instance's current data into a brand-new one — the
 * source keeps running untouched throughout. Built entirely from existing,
 * already-proven pieces (createBackup/restoreBackup, createInstance) rather
 * than real Docker volume snapshotting: that would be faster, but it's
 * riskier, engine-specific, and unverifiable in this sandbox — the same
 * reasoning that picked JSONEachRow over an unverified clickhouse-client
 * pipeline for backups earlier this session. A slower mechanism that's
 * already proven beats a faster one that isn't.
 *
 * Synchronous from the caller's perspective: this doesn't return until the
 * new instance is fully running AND has the source's data, not just created.
 */
export async function createBranch(sourceId: string, auth: AuthContext, name?: string): Promise<InstanceRow> {
  const source = requireRunningInstance(sourceId, auth);
  const manifest = getManifest(source.engine);
  if (!manifest) throw new Error(`unknown engine: ${source.engine}`);

  const backup = await createBackup(source);
  const branchName = name?.trim() || `${source.name}-branch-${Date.now()}`;
  // seed: false — the branch's data is about to come entirely from the
  // restore below. Sample data seeded here first would create the same
  // tables the dump also creates, and the restore's CREATE TABLE/INSERT
  // statements would then collide with it (found for real in CI: the
  // branch silently ended up with its own 3 seeded rows instead of the
  // source's 4, since psql doesn't abort on a per-statement error by
  // default, so the colliding restore "succeeded" while doing nothing).
  const branch = await createInstance(branchName, source.engine, source.owner_id, source.version, { seed: false });

  try {
    const ready = await waitForInstanceRunning(branch.id);
    await restoreBackupInto(ready, backup);
    return instancesRepo.get(branch.id)!;
  } catch (err) {
    // Don't leave a half-created, data-less instance sitting around under a
    // name that implies it's a real copy of the source.
    await deleteInstance(branch.id, auth).catch(() => undefined);
    throw err;
  }
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
