import { randomUUID } from "node:crypto";
import { auditLogRepo, type AuditLogRow } from "./db.js";
import type { AuthContext } from "./auth.js";

function actorLabel(auth: AuthContext): string {
  switch (auth.kind) {
    case "admin":
      return "admin";
    case "user":
      return auth.isSuperadmin ? `superadmin:${auth.userId}` : `user:${auth.userId}`;
    case "scoped":
      return `token:${auth.tokenId}`;
  }
}

/**
 * Records one notable (mutating) action against an instance. Called directly
 * at the point each action already succeeds in routes/instances.ts and
 * routes/browse.ts — not a generic middleware trying to intercept every
 * request, which would log a lot of noise (reads) for little value and make
 * it much less obvious, reading any one route handler, what actually gets
 * recorded and why.
 */
export function recordAudit(instanceId: string, auth: AuthContext, action: string, detail?: string): void {
  auditLogRepo.insert({
    id: randomUUID(),
    instance_id: instanceId,
    actor: actorLabel(auth),
    action,
    detail: detail ?? null,
    created_at: new Date().toISOString(),
  });
}

export function listAuditLog(instanceId: string): AuditLogRow[] {
  return auditLogRepo.listForInstance(instanceId);
}
