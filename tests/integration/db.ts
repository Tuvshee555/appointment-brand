// Per-file test database and helpers for calling services directly.
import { and, eq } from 'drizzle-orm'
import { Client } from 'pg'
import { inject } from 'vitest'
import { createDb, createPool, type Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import type { ServiceContext } from '@/server/context'
import type { CustomerInput } from '@/server/services/booking'
import { resolveSalonId } from '@/server/services/salon'

export interface TestDb {
  db: Database
  url: string
  salonId: string
  close: () => Promise<void>
}

/** Clones the migrated, seeded template into a fresh database for one test file. */
export async function freshDatabase(): Promise<TestDb> {
  const server = inject('pgServer')
  const name = `t_${Math.random().toString(36).slice(2, 10)}`
  const admin = new Client({ connectionString: `${server}/postgres` })
  await admin.connect()
  await admin.query(`create database "${name}" template "${inject('templateDb')}"`)
  await admin.end()

  const url = `${server}/${name}`
  const pool = createPool(url, { max: 10 })
  const db = createDb(pool)
  const salonId = await resolveSalonId(db)
  return { db, url, salonId, close: () => pool.end() }
}

export function context(db: Database, salonId: string, now: Date): ServiceContext {
  return { db, salonId, actor: null, now }
}

export async function serviceId(db: Database, salonId: string, slug: string) {
  const [row] = await db
    .select({ id: t.services.id })
    .from(t.services)
    .where(and(eq(t.services.salonId, salonId), eq(t.services.slug, slug)))
  if (!row) throw new Error(`service ${slug} not seeded`)
  return row.id
}

export async function staffId(db: Database, salonId: string, slug: string) {
  const [row] = await db
    .select({ id: t.staff.id })
    .from(t.staff)
    .where(and(eq(t.staff.salonId, salonId), eq(t.staff.slug, slug)))
  if (!row) throw new Error(`staff ${slug} not seeded`)
  return row.id
}

let phoneSeq = 0
export function customer(name = 'Тест Хэрэглэгч'): CustomerInput {
  phoneSeq += 1
  return { name, phone: `9900${String(phoneSeq).padStart(4, '0')}`, email: null, note: null, preferences: null }
}

/** Minutes from local midnight. */
export const h = (hours: number, minutes = 0) => hours * 60 + minutes
