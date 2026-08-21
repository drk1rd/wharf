import { Router, type Response } from "express";
import { needsSetup, requireSuperadmin } from "../auth.js";
import { getDeploymentSettings, updateDeploymentSettings } from "../settings.js";

export const settingsRouter = Router();

function respondError(res: Response, err: unknown): void {
  const status = (err as Error & { status?: number }).status ?? 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

// Not gated by requireAuth in app.ts (unlike instancesRouter/adminRouter) —
// the setup wizard needs to read/write this before any account exists, the
// same reasoning /auth/signup already applies to account creation itself.
// GET stays open even after setup (same as /api/config) since none of this
// is sensitive; PATCH requires superadmin once an account exists.
settingsRouter.get("/deployment-settings", (_req, res) => {
  res.json(getDeploymentSettings());
});

settingsRouter.patch("/deployment-settings", (req, res) => {
  try {
    if (!needsSetup()) {
      if (!req.auth) {
        res.status(401).json({ error: "sign in required" });
        return;
      }
      requireSuperadmin(req.auth);
    }

    const { publicHost, hostKind, defaultTls } = req.body ?? {};
    if (publicHost !== undefined && typeof publicHost !== "string") {
      res.status(400).json({ error: "publicHost must be a string" });
      return;
    }
    if (hostKind !== undefined && hostKind !== "ip" && hostKind !== "domain") {
      res.status(400).json({ error: 'hostKind must be "ip" or "domain"' });
      return;
    }
    if (defaultTls !== undefined && typeof defaultTls !== "boolean") {
      res.status(400).json({ error: "defaultTls must be a boolean" });
      return;
    }

    const settings = updateDeploymentSettings({ publicHost, hostKind, defaultTls });
    res.json(settings);
  } catch (err) {
    respondError(res, err);
  }
});
