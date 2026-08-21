import "dotenv/config";
import { buildApp } from "./app.js";
import { runDueBackups } from "./backups.js";
import { checkResourceAlerts } from "./alerts.js";
import { getContainerStats } from "./docker.js";
import { instancesRepo } from "./db.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[wharf] control plane listening on :${port}`);
});

// Not started from app.ts/buildApp() — every test boots a fresh app via
// startTestServer(), and a live background timer there would run against
// each test's ephemeral SQLite file and leak between test files. Real
// scheduled backups are exercised directly by calling runDueBackups(), not
// by waiting on this interval.
const schedulerIntervalMs = Number(process.env.WHARF_SCHEDULER_INTERVAL_MS ?? 60_000);
setInterval(() => {
  void runDueBackups((id) => instancesRepo.get(id));
  void checkResourceAlerts(instancesRepo.list(), getContainerStats);
}, schedulerIntervalMs).unref();
