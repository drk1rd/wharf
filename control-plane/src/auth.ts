import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { sessionsRepo, apiTokensRepo, usersRepo, type ApiTokenRow, type InstanceRow } from "./db.js";

const SESSION_COOKIE = "wharf_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const adminToken = process.env.WHARF_TOKEN;
const cookieSecure = process.env.WHARF_COOKIE_SECURE === "true";

export type AuthContext =
  | { kind: "admin" }
  | { kind: "user"; userId: string; isSuperadmin: boolean }
  | { kind: "scoped"; instanceId: string; scope: "read" | "write"; tokenId: string };

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * True until the very first account exists on this instance. There is no
 * anonymous-access bootstrap window anymore — nothing works, for anyone,
 * until that first account is created (see routes/auth.ts's signup
 * handler, which promotes that first account to superadmin automatically).
 * WHARF_TOKEN is a separate, independent credential and doesn't change this.
 */
export function needsSetup(): boolean {
  return usersRepo.count() === 0;
}

if (!adminToken) {
  // eslint-disable-next-line no-console
  console.log(
    "[wharf] WHARF_TOKEN is not set. The first account created on this instance becomes its " +
      "superadmin — full management over every database and every user account. Sign up for it " +
      "at the web UI, or set WHARF_TOKEN for a separate service/CLI credential."
  );
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  sessionsRepo.insert({ id: token, user_id: userId, created_at: new Date().toISOString(), expires_at: expiresAt });
  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    expires: new Date(expiresAt),
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function resolveSession(req: Request): string | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) return null;
  const session = sessionsRepo.get(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    sessionsRepo.remove(token);
    return null;
  }
  return session.user_id;
}

const API_TOKEN_PREFIX = "wst_"; // "wharf scoped token" — distinguishes a scoped token from a stray value at a glance

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mints a token scoped to exactly one instance — only ever returned once, here; only its hash is stored. */
export function mintApiToken(instanceId: string, scope: "read" | "write", name: string | null): { token: string; row: ApiTokenRow } {
  const token = API_TOKEN_PREFIX + randomBytes(24).toString("hex");
  const row: ApiTokenRow = {
    id: randomUUID(),
    instance_id: instanceId,
    token_hash: hashToken(token),
    scope,
    name,
    created_at: new Date().toISOString(),
    last_used_at: null,
  };
  apiTokensRepo.insert(row);
  return { token, row };
}

export function listApiTokens(instanceId: string): ApiTokenRow[] {
  return apiTokensRepo.listForInstance(instanceId);
}

export function revokeApiToken(id: string, instanceId: string): void {
  apiTokensRepo.remove(id, instanceId);
}

function resolveApiToken(presented: string): { instanceId: string; scope: "read" | "write"; tokenId: string } | null {
  if (!presented.startsWith(API_TOKEN_PREFIX)) return null;
  const row = apiTokensRepo.getByHash(hashToken(presented));
  if (!row) return null;
  apiTokensRepo.touch(row.id, new Date().toISOString());
  return { instanceId: row.instance_id, scope: row.scope, tokenId: row.id };
}

/** Throws (403) for a read-scoped token attempting to mutate — every route that writes calls this once req.auth is known. Every other kind (admin/user, and write-scoped tokens) is unrestricted here; whether the caller may touch this *particular* instance at all is canAccessInstance's job, not this one's. */
export function requireWriteAccess(auth: AuthContext): void {
  if (auth.kind === "scoped" && auth.scope === "read") {
    const err = new Error("this token is read-only");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}

/** Throws (403) for anything but the WHARF_TOKEN admin credential or a superadmin account — gates the platform-wide user-management routes (routes/admin.ts). */
export function requireSuperadmin(auth: AuthContext): void {
  if (auth.kind === "admin") return;
  if (auth.kind === "user" && auth.isSuperadmin) return;
  const err = new Error("superadmin access required");
  (err as Error & { status?: number }).status = 403;
  throw err;
}

/** Attaches req.auth on every request, without rejecting — routes decide what each AuthContext kind may do. */
export function identify(req: Request, _res: Response, next: NextFunction): void {
  const provided = req.header("x-wharf-token");
  if (adminToken && provided === adminToken) {
    req.auth = { kind: "admin" };
    next();
    return;
  }

  if (provided) {
    const scoped = resolveApiToken(provided);
    if (scoped) {
      req.auth = { kind: "scoped", instanceId: scoped.instanceId, scope: scoped.scope, tokenId: scoped.tokenId };
      next();
      return;
    }
  }

  const userId = resolveSession(req);
  if (userId) {
    // The session points at a real row (not just an id) so isSuperadmin is
    // always current — a promotion/demotion takes effect on this user's
    // very next request, not just their next login.
    const user = usersRepo.getById(userId);
    if (user) {
      req.auth = { kind: "user", userId, isSuperadmin: Boolean(user.is_superadmin) };
      next();
      return;
    }
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: "sign in required" });
    return;
  }
  next();
}

export function canAccessInstance(row: InstanceRow, auth: AuthContext): boolean {
  if (auth.kind === "admin") return true;
  if (auth.kind === "user" && auth.isSuperadmin) return true;
  if (auth.kind === "scoped") return row.id === auth.instanceId;
  return row.owner_id === null || row.owner_id === auth.userId;
}

export function ownerIdFor(auth: AuthContext): string | null {
  return auth.kind === "user" ? auth.userId : null;
}
