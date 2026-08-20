import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db, sessionsRepo, type InstanceRow } from "./db.js";

const SESSION_COOKIE = "wharf_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const adminToken = process.env.WHARF_TOKEN;
const cookieSecure = process.env.WHARF_COOKIE_SECURE === "true";

export type AuthContext = { kind: "admin" } | { kind: "anonymous" } | { kind: "user"; userId: string };

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function userCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
}

/** False only in the bootstrap state: no WHARF_TOKEN configured and nobody has signed up yet. */
export function authRequired(): boolean {
  return Boolean(adminToken) || userCount() > 0;
}

if (!adminToken) {
  // eslint-disable-next-line no-console
  console.warn(
    "[wharf] WHARF_TOKEN is not set. Until the first account signs up, the API runs in " +
      "single-user local/dev mode (no login required). Fine on a machine only you can reach — " +
      "set WHARF_TOKEN before exposing this to anyone else, and have them sign up for real accounts."
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

/** Attaches req.auth on every request, without rejecting — routes decide what each AuthContext kind may do. */
export function identify(req: Request, _res: Response, next: NextFunction): void {
  const provided = req.header("x-wharf-token");
  if (adminToken && provided === adminToken) {
    req.auth = { kind: "admin" };
    next();
    return;
  }

  const userId = resolveSession(req);
  if (userId) {
    req.auth = { kind: "user", userId };
    next();
    return;
  }

  if (!adminToken && userCount() === 0) {
    req.auth = { kind: "anonymous" };
    next();
    return;
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
  if (auth.kind === "admin" || auth.kind === "anonymous") return true;
  return row.owner_id === null || row.owner_id === auth.userId;
}

export function ownerIdFor(auth: AuthContext): string | null {
  return auth.kind === "user" ? auth.userId : null;
}
