// Shared database tasks for the CLI scripts and the integration test setup.
import { loadEnvConfig } from '@next/env'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import path from 'node:path'
import { createDb, createPool, type Database } from '../../src/server/db/client'
import { ensureOwner, seedBase } from '../../src/server/seed/base'

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle')

export function loadEnv() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', { info: () => {}, error: console.error })
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.')
    process.exit(1)
  }
  return process.env.DATABASE_URL
}

export async function withDb<T>(url: string, fn: (db: Database) => Promise<T>): Promise<T> {
  const pool = createPool(url, { max: 3 })
  try {
    return await fn(createDb(pool))
  } finally {
    await pool.end()
  }
}

export function runMigrations(url: string) {
  return withDb(url, (db) =>
    migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema: 'salon', migrationsTable: '__migrations' }),
  )
}

export async function seed(url: string, { demo }: { demo: boolean }) {
  return withDb(url, async (db) => {
    const base = await seedBase(db)
    console.log(
      `[seed] Salon, settings, hours, roles and catalogue in place (new: ${base.created.services} services, ${base.created.addons} add-ons, ${base.created.staff} staff).`,
    )
    const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env
    if (ADMIN_EMAIL && ADMIN_PASSWORD) {
      const r = await ensureOwner(db, base.salonId, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME ?? 'Эзэмшигч' })
      console.log(r === 'created' ? `[seed] Owner account created (${ADMIN_EMAIL}).` : '[seed] Owner account already exists.')
    }
    if (demo) {
      const { seedDemo } = await import('../../src/server/seed/demo')
      console.log(`[seed] ${await seedDemo(db, { salonId: base.salonId })}`)
    }
    return base.salonId
  })
}
