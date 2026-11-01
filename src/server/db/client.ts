// Database factory without the `server-only` guard so that scripts (migrate,
// seed) and tests can create connections. App code imports `@/server/db`.
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { Pool, type PoolConfig } from 'pg'
import * as schema from './schema'

export type Schema = typeof schema

/** Accepted by every data function: the root database or an open transaction. */
export type Database = PgDatabase<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>

/**
 * Neon and other hosted Postgres require TLS. node-postgres treats
 * sslmode=require as verify-full already; the explicit flag silences its
 * deprecation warning without weakening verification.
 */
function normaliseUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full')
    return url.toString()
  } catch {
    return connectionString
  }
}

export function createPool(connectionString: string, overrides: PoolConfig = {}): Pool {
  return new Pool({
    connectionString: normaliseUrl(connectionString),
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 15_000,
    ...overrides,
  })
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema, casing: 'snake_case' })
}

export { schema }
