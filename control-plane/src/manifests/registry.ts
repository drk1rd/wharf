import type { ServiceManifest } from "./types.js";
import { postgresManifest } from "./postgres.js";
import { mongodbManifest } from "./mongodb.js";

const manifests: Record<string, ServiceManifest> = {
  postgres: postgresManifest,
  mongodb: mongodbManifest,
};

export function getManifest(engine: string): ServiceManifest | undefined {
  return manifests[engine];
}

export function listManifests(): ServiceManifest[] {
  return Object.values(manifests);
}
