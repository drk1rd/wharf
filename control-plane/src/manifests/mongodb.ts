import { randomBytes } from "node:crypto";
import type { ServiceManifest } from "./types.js";

function genPassword(): string {
  return randomBytes(18).toString("base64url");
}

export const mongodbManifest: ServiceManifest = {
  id: "mongodb",
  displayName: "MongoDB",
  versions: ["7", "6"],
  defaultVersion: "7",
  image: (version) => `mongo:${version}`,
  containerPort: 27017,
  dataPath: "/data/db",
  makeSecrets: () => ({
    username: "wharf",
    password: genPassword(),
    database: "app",
  }),
  env: (s) => ({
    MONGO_INITDB_ROOT_USERNAME: s.username,
    MONGO_INITDB_ROOT_PASSWORD: s.password,
    MONGO_INITDB_DATABASE: s.database,
  }),
  connectionString: (s, host, port) =>
    `mongodb://${s.username}:${s.password}@${host}:${port}/${s.database}?authSource=admin`,
  browserAdapter: "mongodb",
  backup: {
    fileExt: "archive",
    dumpCmd: (s) => [
      "mongodump",
      "--username", s.username,
      "--password", s.password,
      "--authenticationDatabase", "admin",
      "--db", s.database,
      "--archive",
    ],
    restoreCmd: (s) => [
      "mongorestore",
      "--username", s.username,
      "--password", s.password,
      "--authenticationDatabase", "admin",
      "--archive",
      "--drop",
    ],
  },
  resourceDefaults: { cpu: "1", memoryMb: 512, diskGb: 2 },
};
