export interface BrowseObject {
  /** Table name (Postgres) or collection name (MongoDB). */
  name: string;
  /** Schema name — Postgres only. */
  schema?: string;
  approxRowCount?: number | null;
}

export interface QueryResult {
  columns?: string[];
  rows: unknown[];
  rowCount: number;
}

export interface BrowserAdapter {
  listObjects(connectionString: string): Promise<BrowseObject[]>;
  browseObject(
    connectionString: string,
    ref: { name: string; schema?: string },
    limit: number,
    offset: number
  ): Promise<QueryResult>;
  /** Postgres: raw SQL. MongoDB: { collection, filter } encoded as JSON string. */
  runQuery(connectionString: string, query: string): Promise<QueryResult>;
  /** Compact plain-text schema summary, used as LLM context for natural-language queries. */
  getSchemaContext(connectionString: string): Promise<string>;
  /**
   * Client-protocol-level full backup/restore, for engines with no reliable
   * stdin/stdout dump-and-restore command (see manifests/redis.ts) — an
   * alternative to ServiceManifest.backup's exec-based mechanism, not a
   * duplicate of it. Omit entirely for engines that already use `backup`.
   */
  dumpAll?(connectionString: string): Promise<Buffer>;
  restoreAll?(connectionString: string, data: Buffer): Promise<void>;
  /**
   * Inserts a small set of sample rows/documents/keys right after a fresh
   * instance becomes ready, so the data browser isn't empty on first look.
   * System-initiated only, with fixed statements — never fed user input, so
   * it doesn't need the safety constraints runQuery has (e.g. MongoDB's
   * find-only restriction).
   */
  seedSampleData?(connectionString: string): Promise<void>;
  /**
   * Inserts already-parsed rows/documents into an existing table/collection
   * (MongoDB creates one implicitly on first insert; SQL engines require it
   * to already exist — see manifests' seedSampleData or the user's own
   * CREATE TABLE). `target` is the table/collection name for every engine
   * except Redis, where each row is instead `{ key, value }` and `target`
   * is unused — Redis has no table/collection concept to import into.
   */
  importRows?(connectionString: string, target: string, rows: Record<string, unknown>[]): Promise<{ inserted: number }>;
}
