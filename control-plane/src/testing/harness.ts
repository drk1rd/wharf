import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

export interface TestServer {
  baseUrl: string;
  dataDir: string;
  close(): Promise<void>;
}

/**
 * Boots a fully isolated control plane for one test file: a fresh temp SQLite
 * dir and a real HTTP listener on an ephemeral port. Must run before any
 * static import of ../app.js / ../db.js / ../auth.js in the same process —
 * those read env vars (WHARF_DATA_DIR, WHARF_TOKEN) at module-load time, so
 * this uses a dynamic import *after* setting them, rather than a static one.
 */
export async function startTestServer(env: Record<string, string | undefined> = {}): Promise<TestServer> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wharf-test-"));
  process.env.WHARF_DATA_DIR = dataDir;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const { buildApp } = await import("../app.js");
  const app = buildApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    dataDir,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export interface ApiResponse {
  status: number;
  body: any;
}

/**
 * A tiny fetch wrapper standing in for a browser tab (session cookie,
 * remembered between calls) or the CLI (a fixed x-wharf-token header) —
 * whichever `auth` option is passed.
 */
export class Client {
  private cookie: string | null = null;
  private readonly token: string | null;

  constructor(private readonly baseUrl: string, auth?: { token: string }) {
    this.token = auth?.token ?? null;
  }

  async request(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.token ? { "x-wharf-token": this.token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }

    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  }

  get(path: string) {
    return this.request("GET", path);
  }
  post(path: string, body?: unknown) {
    return this.request("POST", path, body);
  }
  patch(path: string, body?: unknown) {
    return this.request("PATCH", path, body);
  }
  delete(path: string) {
    return this.request("DELETE", path);
  }
}

/**
 * Signs up the very first account on a fresh test server — which the
 * server itself always promotes to superadmin (see routes/auth.ts) — and
 * returns a Client already holding that session. The standard way for a
 * test file to get a full-access client now that there's no more anonymous
 * bootstrap window; replaces the old "new Client(server.baseUrl) // anonymous
 * bootstrap mode" pattern used throughout this suite before that window
 * was removed.
 */
export async function setupSuperadmin(
  server: TestServer,
  email = "admin@example.com",
  password = "adminpass123"
): Promise<Client> {
  const client = new Client(server.baseUrl);
  const res = await client.post("/api/auth/signup", { email, password });
  if (res.status !== 201) {
    throw new Error(`setupSuperadmin failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return client;
}

/** True if a Docker daemon is actually reachable — gates the real-container integration tests. */
export async function dockerAvailable(): Promise<boolean> {
  try {
    const Docker = (await import("dockerode")).default;
    const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}
