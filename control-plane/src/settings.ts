import { deploymentSettingsRepo, type DeploymentSettingsRow } from "./db.js";

/**
 * Deployment-wide settings, collected in the first-boot setup wizard and
 * editable afterward from Settings by a superadmin. Read at call time (not
 * frozen at module load) so a change here takes effect on the very next
 * request — no restart, matching how every other setting in this codebase
 * that's DB-backed behaves.
 *
 * WHARF_PUBLIC_HOST remains an absolute env-var override on top of whatever
 * is stored here, for existing docker-compose deployments that already set
 * it — an env var always wins, so upgrading never silently changes a
 * running deployment's behavior. WHARF_PROBE_HOST stays env-var-only and is
 * NOT part of this — it's a pure internal Docker-networking concern (how the
 * control plane reaches sibling containers from inside its own container),
 * not something a deployer configures through the setup wizard.
 */

const envPublicHost = process.env.WHARF_PUBLIC_HOST;

export function publicHost(): string {
  if (envPublicHost) return envPublicHost;
  const settings = deploymentSettingsRepo.get();
  return settings?.public_host || "localhost";
}

export function probeHost(): string {
  return process.env.WHARF_PROBE_HOST ?? publicHost();
}

export function defaultTlsEnabled(): boolean {
  return Boolean(deploymentSettingsRepo.get()?.default_tls);
}

export interface PublicDeploymentSettings {
  publicHost: string | null;
  hostKind: "ip" | "domain";
  defaultTls: boolean;
  /** True when WHARF_PUBLIC_HOST is set — the public host field becomes read-only in the UI, since the env var always wins regardless of what's stored. */
  publicHostLockedByEnv: boolean;
}

export function getDeploymentSettings(): PublicDeploymentSettings {
  const row = deploymentSettingsRepo.get();
  return {
    publicHost: row?.public_host ?? null,
    hostKind: row?.host_kind ?? "ip",
    defaultTls: Boolean(row?.default_tls),
    publicHostLockedByEnv: Boolean(envPublicHost),
  };
}

function isValidDomain(value: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(value);
}

function isValidIp(value: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  return value.split(".").every((octet) => Number(octet) <= 255);
}

export function updateDeploymentSettings(patch: { publicHost?: string; hostKind?: "ip" | "domain"; defaultTls?: boolean }): PublicDeploymentSettings {
  const dbPatch: { public_host?: string | null; host_kind?: "ip" | "domain"; default_tls?: number } = {};

  if (patch.publicHost !== undefined) {
    const value = patch.publicHost.trim();
    const kind = patch.hostKind ?? deploymentSettingsRepo.get()?.host_kind ?? "ip";
    if (value) {
      if (kind === "ip" && !isValidIp(value)) {
        const err = new Error("publicHost must be a valid IPv4 address when hostKind is \"ip\"");
        (err as Error & { status?: number }).status = 400;
        throw err;
      }
      if (kind === "domain" && !isValidDomain(value)) {
        const err = new Error("publicHost must be a valid domain name when hostKind is \"domain\"");
        (err as Error & { status?: number }).status = 400;
        throw err;
      }
    }
    dbPatch.public_host = value || null;
  }
  if (patch.hostKind !== undefined) {
    if (patch.hostKind !== "ip" && patch.hostKind !== "domain") {
      const err = new Error('hostKind must be "ip" or "domain"');
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    dbPatch.host_kind = patch.hostKind;
  }
  if (patch.defaultTls !== undefined) {
    dbPatch.default_tls = patch.defaultTls ? 1 : 0;
  }

  const row: DeploymentSettingsRow = deploymentSettingsRepo.upsert(dbPatch);
  return {
    publicHost: row.public_host,
    hostKind: row.host_kind,
    defaultTls: Boolean(row.default_tls),
    publicHostLockedByEnv: Boolean(envPublicHost),
  };
}
