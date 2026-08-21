const BASE = "/api";
const TOKEN = import.meta.env.VITE_WHARF_TOKEN as string | undefined;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { "x-wharf-token": TOKEN } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error ?? `request failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
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
  backupSupported: boolean;
  backupSchedule: { intervalHours: number; retentionCount: number; lastRunAt: string | null } | null;
}

export interface ApiToken {
  id: string;
  scope: "read" | "write";
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
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

export interface AskResult {
  query: string;
  explanation: string;
  result: QueryResult;
  model: string;
}

export interface User {
  id: string;
  email: string;
  defaultModel: string | null;
}

export interface OpenRouterModel {
  id: string;
  name?: string;
  contextLength?: number;
}

export const api = {
  getConfig: () => request<{ askEnabled: boolean; authRequired: boolean }>("/config"),
  signup: (email: string, password: string) =>
    request<User>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<User>("/auth/me"),
  updateSettings: (patch: { defaultModel?: string }) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify(patch) }),
  listModels: () => request<OpenRouterModel[]>("/models"),

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
  ask: (id: string, question: string, model?: string) =>
    request<AskResult>(`/instances/${id}/ask`, { method: "POST", body: JSON.stringify({ question, model }) }),
  resizeInstance: (id: string, cpu: string, memoryMb: number) =>
    request<Instance>(`/instances/${id}/resize`, { method: "PATCH", body: JSON.stringify({ cpu, memoryMb }) }),
  importData: (id: string, format: "csv" | "json", target: string, data: string) =>
    request<{ inserted: number }>(`/instances/${id}/browse/import`, {
      method: "POST",
      body: JSON.stringify({ format, target, data }),
    }),
  setBackupSchedule: (id: string, intervalHours: number | null, retentionCount?: number) =>
    request<Instance["backupSchedule"]>(`/instances/${id}/backup-schedule`, {
      method: "PATCH",
      body: JSON.stringify({ intervalHours, retentionCount }),
    }),
  listTokens: (id: string) => request<ApiToken[]>(`/instances/${id}/tokens`),
  mintToken: (id: string, scope: "read" | "write", name: string) =>
    request<ApiToken & { token: string }>(`/instances/${id}/tokens`, {
      method: "POST",
      body: JSON.stringify({ scope, name: name || undefined }),
    }),
  revokeToken: (id: string, tokenId: string) => request<void>(`/instances/${id}/tokens/${tokenId}`, { method: "DELETE" }),
};
