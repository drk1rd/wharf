const BASE = "/api";
const TOKEN = import.meta.env.VITE_WHARF_TOKEN as string | undefined;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { "x-wharf-token": TOKEN } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/plain")) return (await res.text()) as unknown as T;
  return res.json() as Promise<T>;
}

export interface Engine {
  id: string;
  displayName: string;
  versions: string[];
  defaultVersion: string;
}

export interface Instance {
  id: string;
  name: string;
  engine: string;
  version: string;
  status: "creating" | "running" | "stopped" | "error";
  createdAt: string;
  error: string | null;
  resources: { cpu: string; memoryMb: number; diskGb: number };
  connection: { host: string; port: number; connectionString: string } | null;
}

export interface ContainerStats {
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
  blkReadBytes: number;
  blkWriteBytes: number;
}

export interface BrowseObject {
  name: string;
  schema?: string;
  approxRowCount?: number | null;
}

export interface QueryResult {
  columns?: string[];
  rows: unknown[];
  rowCount: number;
}

export interface Backup {
  id: string;
  instance_id: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
}

export const api = {
  listEngines: () => request<Engine[]>("/engines"),
  listInstances: () => request<Instance[]>("/instances"),
  getInstance: (id: string) => request<Instance>(`/instances/${id}`),
  createInstance: (name: string, engine: string, version?: string) =>
    request<Instance>("/instances", { method: "POST", body: JSON.stringify({ name, engine, version }) }),
  deleteInstance: (id: string) => request<void>(`/instances/${id}`, { method: "DELETE" }),
  getMetrics: (id: string) => request<ContainerStats>(`/instances/${id}/metrics`),
  getLogs: (id: string) => request<string>(`/instances/${id}/logs`),
  listObjects: (id: string) => request<BrowseObject[]>(`/instances/${id}/browse/objects`),
  browseObject: (id: string, name: string, schema: string | undefined, limit: number, offset: number) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (schema) params.set("schema", schema);
    return request<QueryResult>(`/instances/${id}/browse/objects/${encodeURIComponent(name)}/rows?${params}`);
  },
  runQuery: (id: string, query: string) =>
    request<QueryResult>(`/instances/${id}/browse/query`, { method: "POST", body: JSON.stringify({ query }) }),
  listBackups: (id: string) => request<Backup[]>(`/instances/${id}/backups`),
  createBackup: (id: string) => request<Backup>(`/instances/${id}/backups`, { method: "POST" }),
  restoreBackup: (id: string, backupId: string) =>
    request<void>(`/instances/${id}/restore`, { method: "POST", body: JSON.stringify({ backupId }) }),
};
