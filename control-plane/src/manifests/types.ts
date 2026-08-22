export interface InstanceSecrets {
  username: string;
  password: string;
  database: string;
}

export type BrowserAdapterId = "postgres" | "mongodb" | "mysql" | "redis" | "clickhouse";

export interface ServiceManifest {
  /** Stable engine id, also used as the docker image family and API value. */
  id: string;
  displayName: string;
  versions: string[];
  defaultVersion: string;
  image(version: string): string;
  /** The single port the engine listens on inside its container. */
  containerPort: number;
  /** Path inside the container where persistent data lives — gets a named volume. */
  dataPath: string;
  /** Overrides the image's default command — needed when a secret can only be passed as a CLI flag (e.g. Redis's --requirepass). */
  command?(secrets: InstanceSecrets): string[];
  makeSecrets(instanceId: string): InstanceSecrets;
  env(secrets: InstanceSecrets): Record<string, string>;
  connectionString(secrets: InstanceSecrets, host: string, port: number): string;
  browserAdapter: BrowserAdapterId;
  /** Omitted when the engine has no reliable stdin/stdout dump-and-restore path (e.g. Redis — see manifests/redis.ts). */
  backup?: {
    fileExt: string;
    /** Command run inside the container; stdout bytes are the backup archive. */
    dumpCmd(secrets: InstanceSecrets): string[];
    /** Command run inside the container; stdin bytes are the backup archive. */
    restoreCmd(secrets: InstanceSecrets): string[];
  };
  resourceDefaults: { cpu: string; memoryMb: number; diskGb: number };
  /**
   * Self-signed-CA TLS support, if implemented for this engine. When present
   * and enabled for an instance, docker.ts injects a CA-signed leaf cert
   * into certDir and wraps the container's command so the certs are
   * chowned/permissioned for runtimeUser before the engine's own entrypoint
   * runs — see docker.ts's createInstanceContainer. Not every engine has
   * this: Redis needs a second dedicated TLS port and ClickHouse needs an
   * XML config block plus a second HTTPS port, both bigger structural
   * changes than the CLI-flag engines below, so both are deliberately left
   * without a `tls` block for now.
   */
  tls?: {
    /** Absolute path inside the container where certs get written. */
    certDir: string;
    /** OS user the engine's server process runs as inside the image — certs get chowned to this before start. */
    runtimeUser: string;
    /** The image's own entrypoint script (already on PATH), exec'd after permissions are fixed. */
    entrypoint: string;
    /** Full command args (same shape as `command`, plus TLS flags) to hand to entrypoint. */
    args(secrets: InstanceSecrets, certDir: string): string[];
    /** Appended to the connection string used for the control plane's own outbound connections (readiness probe, data browser) — trusts the deployment's own CA without verifying it against a public root, since this traffic never leaves the deployer's own network. */
    internalConnectionSuffix(): string;
    /** Appended to the connection string shown to end users — encrypts without requiring them to import the deployment's self-signed CA first. */
    externalConnectionSuffix(): string;
  };
}
