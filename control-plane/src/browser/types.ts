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
}
