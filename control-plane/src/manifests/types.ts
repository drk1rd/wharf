export interface InstanceSecrets {
  username: string;
  password: string;
  database: string;
}

export type BrowserAdapterId = "postgres" | "mongodb";

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
  makeSecrets(instanceId: string): InstanceSecrets;
  env(secrets: InstanceSecrets): Record<string, string>;
  connectionString(secrets: InstanceSecrets, host: string, port: number): string;
  browserAdapter: BrowserAdapterId;
  backup: {
    fileExt: string;
    /** Command run inside the container; stdout bytes are the backup archive. */
    dumpCmd(secrets: InstanceSecrets): string[];
    /** Command run inside the container; stdin bytes are the backup archive. */
    restoreCmd(secrets: InstanceSecrets): string[];
  };
  resourceDefaults: { cpu: string; memoryMb: number; diskGb: number };
}
