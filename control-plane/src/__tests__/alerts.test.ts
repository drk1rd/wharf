import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { InstanceRow } from "../db.js";

// A tiny real HTTP server standing in for the webhook receiver — no mocking
// of fetch, an actual local request/response round trip, so this proves the
// payload really goes out over the network in the shape claimed. Env vars
// read by alerts.ts at import time, so they're set before the dynamic
// import, same reasoning as harness.ts's startTestServer.
const received: any[] = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received.push(JSON.parse(body || "{}"));
    res.writeHead(200);
    res.end();
  });
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const { port } = server.address() as AddressInfo;

process.env.WHARF_ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}`;
process.env.WHARF_ALERT_CPU_THRESHOLD_PERCENT = "80";
process.env.WHARF_ALERT_MEMORY_THRESHOLD_PERCENT = "80";
process.env.WHARF_ALERT_SLOW_QUERY_MS = "100";

const { checkResourceAlerts, alertSlowQuery, alertingEnabled } = await import("../alerts.js");

function fakeInstance(id: string, name: string, status: InstanceRow["status"] = "running"): InstanceRow {
  return {
    id,
    owner_id: null,
    name,
    engine: "postgres",
    version: "16",
    status,
    container_id: "fake-container",
    volume_name: "fake-volume",
    host_port: 1,
    username: "u",
    password: "p",
    database_name: "d",
    cpu: "1",
    memory_mb: 512,
    disk_gb: 2,
    created_at: new Date().toISOString(),
    error: null,
  };
}

test("alertingEnabled reflects whether the webhook is configured", () => {
  assert.equal(alertingEnabled(), true);
});

test("checkResourceAlerts fires once over the cpu threshold, and not again within the cooldown", async () => {
  const row = fakeInstance("i1", "high-cpu-test");
  const getStats = async () => ({
    cpuPercent: 95,
    memUsageBytes: 100,
    memLimitBytes: 1000,
    netRxBytes: 0,
    netTxBytes: 0,
    blkReadBytes: 0,
    blkWriteBytes: 0,
  });
  received.length = 0;

  await checkResourceAlerts([row], getStats);
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "high_cpu");
  assert.equal(received[0].instanceId, "i1");
  assert.equal(received[0].instanceName, "high-cpu-test");

  await checkResourceAlerts([row], getStats);
  assert.equal(received.length, 1, "cooldown should suppress a second alert right after the first");
});

test("checkResourceAlerts fires over the memory threshold", async () => {
  const row = fakeInstance("i2", "high-mem-test");
  const getStats = async () => ({
    cpuPercent: 10,
    memUsageBytes: 900,
    memLimitBytes: 1000,
    netRxBytes: 0,
    netTxBytes: 0,
    blkReadBytes: 0,
    blkWriteBytes: 0,
  });
  received.length = 0;

  await checkResourceAlerts([row], getStats);
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "high_memory");
  assert.ok(received[0].memoryPercent >= 80);
});

test("checkResourceAlerts skips instances that aren't running, without calling getStats", async () => {
  const row = fakeInstance("i3", "not-running", "error");
  received.length = 0;
  await checkResourceAlerts([row], async () => {
    throw new Error("getStats should never be called for a non-running instance");
  });
  assert.equal(received.length, 0);
});

test("checkResourceAlerts tolerates a getStats failure for one instance instead of throwing", async () => {
  const row = fakeInstance("i4", "unreachable");
  received.length = 0;
  await assert.doesNotReject(checkResourceAlerts([row], async () => {
    throw new Error("no daemon reachable");
  }));
  assert.equal(received.length, 0);
});

test("alertSlowQuery only fires once a query exceeds the configured threshold", async () => {
  received.length = 0;
  await alertSlowQuery("i5", "slow-test", 50, "SELECT 1");
  assert.equal(received.length, 0, "below threshold — shouldn't alert");

  await alertSlowQuery("i5", "slow-test", 500, "SELECT pg_sleep(1)");
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "slow_query");
  assert.equal(received[0].durationMs, 500);
  assert.equal(received[0].instanceName, "slow-test");
});

after(() => server.close());
