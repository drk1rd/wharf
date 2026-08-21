import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer, setupSuperadmin } from "../testing/harness.js";

// WHARF_MAX_INSTANCES caps instance *count*, but live resize lets any single
// instance grow to 16 cores / 32GB with no ceiling of its own — a handful of
// resizes could starve a shared host even under a low count cap. These tests
// cover the separate aggregate cpu/memory budget that closes that gap.
// Instance rows are inserted directly (bypassing Docker), same pattern as
// ownership.test.ts, so these run everywhere without a daemon.
const server = await startTestServer({ WHARF_MAX_TOTAL_CPU: "2", WHARF_MAX_TOTAL_MEMORY_MB: "1024" });
const { instancesRepo } = await import("../db.js");
const client = await setupSuperadmin(server);

function fakeRunningInstance(cpu: string, memoryMb: number) {
  const row = {
    id: randomUUID(),
    owner_id: null,
    name: "budget-test",
    engine: "postgres",
    version: "16",
    status: "running" as const,
    container_id: "fake-container",
    volume_name: "fake-volume",
    host_port: 55432,
    username: "wharf",
    password: "not-a-real-secret",
    database_name: "app",
    cpu,
    memory_mb: memoryMb,
    disk_gb: 2,
    created_at: new Date().toISOString(),
    error: null,
    tls_enabled: 0,
  };
  instancesRepo.insert(row);
  return row;
}

test("create is rejected once it would exceed the total cpu/memory budget", async () => {
  fakeRunningInstance("1.5", 768);

  // postgres's defaults (cpu 1, 512MB) pushed on top of what's already
  // reserved (1.5 cpu, 768MB) would land at 2.5 cpu — over the 2-core budget.
  const res = await client.post("/api/instances", { engine: "postgres" });
  assert.equal(res.status, 429);
  assert.match(res.body.error, /CPU budget/);
});

test("resize is rejected once it would exceed the total memory budget", async () => {
  const row = fakeRunningInstance("0.5", 256);

  // Nothing else is reserved besides this instance's own (excluded) current
  // allocation, so the requested 2048MB alone already exceeds the 1024MB cap.
  const res = await client.patch(`/api/instances/${row.id}/resize`, { memoryMb: 2048 });
  assert.equal(res.status, 429);
  assert.match(res.body.error, /memory budget/);
});

// "unrestricted when unconfigured" isn't retested here: the env-driven budget
// constants are read once at module load (same reason startTestServer's own
// comment gives for setting env before any import), so a second differently-
// configured server in this same process/file wouldn't actually change them.
// Every other test file in this suite runs with these vars unset and creates
// instances successfully, which is exactly that coverage.

after(() => server.close());
