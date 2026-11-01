import 'server-only'
import type { Pool } from 'pg'
import { createDb, createPool, type Database } from './client'

// One pool per server instance. In development the module can be re-evaluated
// on hot reload, so the pool is kept on globalThis to avoid leaking connections.
const globalForDb = globalThis as unknown as { __salonPool?: Pool }

function getPool(): Pool {
  if (!globalForDb.__salonPool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    globalForDb.__salonPool = createPool(url)
  }
  return globalForDb.__salonPool
}

export const db: Database = createDb(getPool())

export type { Database }
export * as t from './schema'
