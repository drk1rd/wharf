import { Router, type Response } from "express";
import { usersRepo, sessionsRepo, instancesRepo, type UserRow } from "../db.js";
import { requireSuperadmin } from "../auth.js";

export const adminRouter = Router();

function respondError(res: Response, err: unknown): void {
  const status = (err as Error & { status?: number }).status ?? 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    isSuperadmin: Boolean(user.is_superadmin),
    createdAt: user.created_at,
    instanceCount: instancesRepo.countOwnedBy(user.id),
  };
}

/**
 * Platform-wide user management — every route here is superadmin-only
 * (WHARF_TOKEN or a superadmin account), regardless of the requireAuth
 * gate every other router in app.ts also sits behind. This is the "must
 * have all management for everything" surface: instance-level access is
 * already covered by canAccessInstance (auth.ts) treating a superadmin
 * like the admin token everywhere; this covers accounts themselves.
 */
adminRouter.get("/users", (req, res) => {
  try {
    requireSuperadmin(req.auth!);
    res.json(usersRepo.list().map(publicUser));
  } catch (err) {
    respondError(res, err);
  }
});

adminRouter.patch("/users/:id", (req, res) => {
  try {
    requireSuperadmin(req.auth!);
    if (req.auth!.kind === "user" && req.auth!.userId === req.params.id) {
      res.status(400).json({ error: "you can't change your own superadmin status here" });
      return;
    }
    const target = usersRepo.getById(req.params.id);
    if (!target) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    const { isSuperadmin } = req.body ?? {};
    if (typeof isSuperadmin !== "boolean") {
      res.status(400).json({ error: "isSuperadmin must be a boolean" });
      return;
    }
    if (!isSuperadmin && Boolean(target.is_superadmin) && usersRepo.countSuperadmins() <= 1) {
      res.status(400).json({ error: "can't remove the last remaining superadmin — promote someone else first" });
      return;
    }
    usersRepo.update(req.params.id, { is_superadmin: isSuperadmin ? 1 : 0 });
    res.json(publicUser(usersRepo.getById(req.params.id)!));
  } catch (err) {
    respondError(res, err);
  }
});

adminRouter.delete("/users/:id", (req, res) => {
  try {
    requireSuperadmin(req.auth!);
    if (req.auth!.kind === "user" && req.auth!.userId === req.params.id) {
      res.status(400).json({ error: "you can't delete your own account here" });
      return;
    }
    const target = usersRepo.getById(req.params.id);
    if (!target) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    // Reassign, don't delete — a removed account's databases are still
    // real, running data. They become ownerless (visible to every user,
    // same as an instance created before any account existed), not gone.
    for (const instance of instancesRepo.listOwnedBy(req.params.id)) {
      instancesRepo.update(instance.id, { owner_id: null });
    }
    sessionsRepo.removeForUser(req.params.id);
    usersRepo.remove(req.params.id);
    res.status(204).end();
  } catch (err) {
    respondError(res, err);
  }
});
