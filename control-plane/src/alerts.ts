import type { ContainerStats } from "./docker.js";
import type { InstanceRow } from "./db.js";

const WEBHOOK_URL = process.env.WHARF_ALERT_WEBHOOK_URL;
const CPU_THRESHOLD_PERCENT = Number(process.env.WHARF_ALERT_CPU_THRESHOLD_PERCENT ?? 90);
const MEMORY_THRESHOLD_PERCENT = Number(process.env.WHARF_ALERT_MEMORY_THRESHOLD_PERCENT ?? 90);
const SLOW_QUERY_MS = Number(process.env.WHARF_ALERT_SLOW_QUERY_MS ?? 5000);
const COOLDOWN_MS = Number(process.env.WHARF_ALERT_COOLDOWN_MINUTES ?? 30) * 60_000;

export function alertingEnabled(): boolean {
  return Boolean(WEBHOOK_URL);
}

// In-memory, not persisted — alerts are transient notifications, not an
// audit trail (that's audit.ts's job), so losing the cooldown window on a
// restart is a reasonable trade for not needing a DB table for it.
const lastAlertAt = new Map<string, number>();

function shouldAlert(key: string, now: number): boolean {
  const last = lastAlertAt.get(key);
  if (last !== undefined && now - last < COOLDOWN_MS) return false;
  lastAlertAt.set(key, now);
  return true;
}

async function sendAlert(payload: Record<string, unknown>): Promise<void> {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
    });
  } catch (err) {
    // A broken webhook must never take down the thing it's watching.
    // eslint-disable-next-line no-console
    console.error("[wharf] alert webhook delivery failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Checked once per scheduler tick (see index.ts) for every running instance
 * — best-effort per instance, same reasoning as backups.ts's runDueBackups:
 * one instance's engine/container being briefly unreachable doesn't stop the
 * rest from being checked, it just tries again next tick. getStats is
 * injected (rather than importing docker.ts's getContainerStats directly)
 * so this is testable without a real Docker daemon.
 */
export async function checkResourceAlerts(rows: InstanceRow[], getStats: (containerId: string) => Promise<ContainerStats>): Promise<void> {
  if (!WEBHOOK_URL) return;
  const now = Date.now();
  for (const row of rows) {
    if (row.status !== "running" || !row.container_id) continue;
    try {
      const stats = await getStats(row.container_id);
      const memoryPercent = stats.memLimitBytes > 0 ? (stats.memUsageBytes / stats.memLimitBytes) * 100 : 0;

      if (stats.cpuPercent >= CPU_THRESHOLD_PERCENT && shouldAlert(`${row.id}:cpu`, now)) {
        await sendAlert({
          type: "high_cpu",
          instanceId: row.id,
          instanceName: row.name,
          cpuPercent: stats.cpuPercent,
          thresholdPercent: CPU_THRESHOLD_PERCENT,
        });
      }
      if (memoryPercent >= MEMORY_THRESHOLD_PERCENT && shouldAlert(`${row.id}:memory`, now)) {
        await sendAlert({
          type: "high_memory",
          instanceId: row.id,
          instanceName: row.name,
          memoryPercent,
          thresholdPercent: MEMORY_THRESHOLD_PERCENT,
        });
      }
    } catch {
      // Container/daemon unreachable this tick — retried next tick, not fatal.
    }
  }
}

/** Called from the query route once a query finishes — durationMs is measured by the caller, not here. */
export async function alertSlowQuery(instanceId: string, instanceName: string, durationMs: number, query: string): Promise<void> {
  if (!WEBHOOK_URL || durationMs < SLOW_QUERY_MS) return;
  if (!shouldAlert(`${instanceId}:slow-query`, Date.now())) return;
  await sendAlert({
    type: "slow_query",
    instanceId,
    instanceName,
    durationMs,
    query: query.length > 200 ? `${query.slice(0, 200)}…` : query,
  });
}
