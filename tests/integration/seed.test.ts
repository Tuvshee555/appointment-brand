import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APPOINTMENT_STATUSES } from '@/lib/booking/status'
import * as t from '@/server/db/schema'
import { seedBase } from '@/server/seed/base'
import { deleteDemoData, hasDemoData, seedDemo } from '@/server/seed/demo'
import { createBooking } from '@/server/services/booking'
import { SEED_NOW } from './constants'
import { context, customer, freshDatabase, h, serviceId, type TestDb } from './db'

let env: TestDb

beforeAll(async () => {
  env = await freshDatabase()
})
afterAll(() => env.close())

async function catalogueCounts() {
  const count = (table: Parameters<typeof env.db.$count>[0]) => env.db.$count(table)
  return {
    services: await count(t.services),
    addons: await count(t.serviceAddons),
    staff: await count(t.staff),
    roles: await count(t.adminRoles),
    hours: await count(t.openingHours),
    holidays: await count(t.specialDays),
  }
}

/** Slot-holding appointments of the same specialist that overlap (must be none). */
async function overlappingPairs() {
  const res = await env.db.execute<{ n: number }>(sql`
    select count(*)::int as n from salon.appointments a
    join salon.appointments b on a.staff_id = b.staff_id and a.id < b.id
    where a.status in ('awaiting_deposit','pending','confirmed','completed','no_show')
      and b.status in ('awaiting_deposit','pending','confirmed','completed','no_show')
      and tstzrange(a.starts_at, a.occupied_until) && tstzrange(b.starts_at, b.occupied_until)`)
  return res.rows[0].n
}

describe('base seed', () => {
  it('creates the catalogue and can run again without duplicating anything', async () => {
    const before = await catalogueCounts()
    expect(before.services).toBeGreaterThanOrEqual(20)
    expect(before.services).toBeLessThanOrEqual(25)
    expect(before.staff).toBeGreaterThanOrEqual(5)
    expect(before.hours).toBe(7)

    const again = await seedBase(env.db, { now: SEED_NOW })
    expect(again.created).toEqual({ services: 0, staff: 0, addons: 0 })
    expect(await catalogueCounts()).toEqual(before)
  })
})

describe('demo data', () => {
  it('creates a realistic, consistent schedule', async () => {
    await seedDemo(env.db, { salonId: env.salonId, now: SEED_NOW })
    const demoCustomers = await env.db.$count(
      t.customers,
      and(eq(t.customers.salonId, env.salonId), eq(t.customers.isDemo, true)),
    )
    const appointments = await hasDemoData(env.db, env.salonId)
    expect(demoCustomers).toBeGreaterThanOrEqual(30)
    expect(demoCustomers).toBeLessThanOrEqual(50)
    expect(appointments).toBeGreaterThanOrEqual(50)
    expect(appointments).toBeLessThanOrEqual(100)

    const statuses = await env.db.selectDistinct({ status: t.appointments.status }).from(t.appointments)
    expect(statuses.map((s) => s.status).sort()).toEqual([...APPOINTMENT_STATUSES].sort())
    expect(await overlappingPairs()).toBe(0)

    // Paid payments are always verified by the provider or recorded by staff.
    const unverified = await env.db.$count(
      t.payments,
      and(eq(t.payments.status, 'paid'), sql`${t.payments.verifiedBy} is null`),
    )
    expect(unverified).toBe(0)
  })

  it('skips seeding when demo data is already there', async () => {
    const before = await hasDemoData(env.db, env.salonId)
    const message = await seedDemo(env.db, { salonId: env.salonId, now: SEED_NOW })
    expect(message).toMatch(/skipped/)
    expect(await hasDemoData(env.db, env.salonId)).toBe(before)
  })

  it('resets only demo rows and leaves real bookings and the catalogue alone', async () => {
    const real = await createBooking(
      context(env.db, env.salonId, SEED_NOW),
      {
        items: [{ serviceId: await serviceId(env.db, env.salonId, 'classic-manicure'), addonIds: [] }],
        staffId: null,
        date: '2026-12-10',
        start: h(11),
        customer: customer('Жинхэнэ Үйлчлүүлэгч'),
      },
      { source: 'phone', actor: 'staff', publicRules: false, isDemo: false, staffStatus: 'confirmed' },
    )
    const catalogue = await catalogueCounts()

    await deleteDemoData(env.db, env.salonId)

    expect(await hasDemoData(env.db, env.salonId)).toBe(0)
    expect(
      await env.db.$count(t.customers, and(eq(t.customers.salonId, env.salonId), eq(t.customers.isDemo, true))),
    ).toBe(0)
    const [kept] = await env.db.select().from(t.appointments).where(eq(t.appointments.id, real.appointmentId))
    expect(kept.status).toBe('confirmed')
    // Demo-only special days go, the real holiday calendar stays.
    expect((await catalogueCounts()).services).toBe(catalogue.services)
    expect((await catalogueCounts()).holidays).toBeGreaterThan(0)

    // A fresh demo seed works after the reset.
    await seedDemo(env.db, { salonId: env.salonId, now: SEED_NOW })
    expect(await hasDemoData(env.db, env.salonId)).toBeGreaterThanOrEqual(50)
    expect(await overlappingPairs()).toBe(0)
  })
})
