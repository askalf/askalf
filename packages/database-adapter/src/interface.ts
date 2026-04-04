/**
 * Database Adapter Interface
 *
 * Abstracts the query layer so forge, dashboard, and mcp-tools can run against
 * either a real PostgreSQL server (Docker/production) or PGlite (standalone mode)
 * without changing any SQL.
 */

export interface QueryResultRow {
  [key: string]: unknown;
}

export interface TransactionClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface DatabaseAdapter {
  /** Execute a query and return all rows. */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;

  /** Execute a query and return the first row or null. */
  queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T | null>;

  /** Run a function inside a transaction. */
  transaction<T>(
    fn: (client: TransactionClient) => Promise<T>,
  ): Promise<T>;

  /** Close the database connection. */
  close(): Promise<void>;

  /** The underlying mode. */
  readonly mode: 'pg' | 'pglite';
}
