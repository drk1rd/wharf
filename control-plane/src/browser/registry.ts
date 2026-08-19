import type { BrowserAdapter } from "./types.js";
import { postgresAdapter } from "./postgres.js";
import { mongodbAdapter } from "./mongodb.js";
import type { BrowserAdapterId } from "../manifests/types.js";

const adapters: Record<BrowserAdapterId, BrowserAdapter> = {
  postgres: postgresAdapter,
  mongodb: mongodbAdapter,
};

export function getBrowserAdapter(id: BrowserAdapterId): BrowserAdapter {
  return adapters[id];
}
