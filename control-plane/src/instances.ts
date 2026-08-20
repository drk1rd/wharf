import { randomUUID } from "node:crypto";
import { instancesRepo, type InstanceRow } from "./db.js";
import { getManifest } from "./manifests/registry.js";
import type { InstanceSecrets, ServiceManifest } from "./manifests/types.js";
import { createInstanceContainer, stopAndRemoveContainer, waitForPort } from "./docker.js";
import { canAccessInstance, type AuthContext } from "./auth.js";

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

async function provision(id: string, manifest: ServiceManifest, version: string, secrets: InstanceSecrets): Promise<void> {
  try {
    const { containerId, volumeName, hostPort } = await createInstanceContainer({
      instanceId: id,
      manifest,
      version,
      secrets,
    });
    instancesRepo.update(id, { container_id: containerId, volume_name: volumeName, host_port: hostPort });

    const ready = await waitForPort(PROBE_HOST, hostPort);
    if (!ready) throw new Error("engine did not become ready in time");
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
