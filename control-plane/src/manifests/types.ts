export interface InstanceSecrets {
  username: string;
  password: string;
  database: string;
}

export type BrowserAdapterId = "postgres" | "mongodb" | "mysql" | "redis";

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
}
