import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ubToUtc } from '@/lib/datetime'
import { ServiceError } from '@/server/context'
import * as t from '@/server/db/schema'
import {
  createBooking,
  expireStaleHolds,
  pgErrorCode,
  rescheduleAppointment,
  transitionAppointment,
  type CreateBookingOptions,
} from '@/server/services/booking'
import { context, customer, freshDatabase, h, serviceId, staffId, type TestDb } from './db'

const NOW = new Date('2026-11-03T00:00:00Z') // Tuesday 08:00 in Ulaanbaatar
const THU = '2026-11-12'
const FRI = '2026-11-13'
const online: CreateBookingOptions = { source: 'website', actor: 'customer', publicRules: true, isDemo: false }

let env: TestDb
let gel: string // 90 min, 65,000₮, no deposit
let extensions: string // 150 min + 15 min buffer, 120,000₮, deposit
let solongo: string // Tue–Sat 10:00–18:00, lunch 13:00–13:30

beforeAll(async () => {
  env = await freshDatabase()
  gel = await serviceId(env.db, env.salonId, 'gel-polish')
  extensions = await serviceId(env.db, env.salonId, 'nail-extensions')
  solongo = await staffId(env.db, env.salonId, 'solongo')
})
afterAll(() => env.close())

const ctx = (now = NOW) => context(env.db, env.salonId, now)
const book = (service: string, date: string, start: number, opts: { staff?: string | null; now?: Date } = {}) =>
  createBooking(
    ctx(opts.now),
    {
      items: [{ serviceId: service, addonIds: [] }],
      staffId: opts.staff ?? solongo,
      date,
      start,
      customer: customer(),
    },
    online,
  )

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise
  } catch (err) {
    return err instanceof ServiceError ? err.code : (pgErrorCode(err) ?? String(err))
  }
  return null
}

describe('creating a booking', () => {
  it('stores a request with a price snapshot and the occupied time', async () => {
    const result = await book(gel, THU, h(10))
    expect(result.status).toBe('pending') // manual confirmation, no deposit below 100,000₮
    expect(result.reference).toMatch(/^SV-[A-Z0-9]{6}$/)
    expect(result.startsAt).toBe(ubToUtc(THU, h(10)).toISOString())

    const [appt] = await env.db.select().from(t.appointments).where(eq(t.appointments.id, result.appointmentId))
    expect(appt.totalPrice).toBe(65_000)
    expect(appt.durationMinutes).toBe(90)
    expect(appt.occupiedUntil.getTime() - appt.endsAt.getTime()).toBe(appt.bufferMinutes * 60_000)
    expect(appt.manageTokenHash).not.toBe(result.manageToken) // only the hash is stored

    const lines = await env.db
      .select()
      .from(t.appointmentServices)
      .where(eq(t.appointmentServices.appointmentId, result.appointmentId))
    expect(lines).toMatchObject([{ serviceName: 'Гель будалт', price: 65_000, durationMinutes: 90 }])
  })

  it('refuses a start that overlaps the specialist’s existing booking or its buffer', async () => {
    // 10:00–11:30 is taken and occupied until 11:40.
    expect(await errorCode(book(gel, THU, h(11, 30)))).toBe('slot_unavailable')
    // 11:45 would end at 13:15, inside the 13:00–13:30 lunch break.
    expect(await errorCode(book(gel, THU, h(11, 45)))).toBe('slot_unavailable')
    const ok = await book(gel, THU, h(13, 30))
    expect(ok.staffId).toBe(solongo)
  })

  it('refuses times inside a break, outside the shift or too soon', async () => {
    expect(await errorCode(book(gel, THU, h(12, 30)))).toBe('slot_unavailable') // runs into lunch
    expect(await errorCode(book(gel, THU, h(17)))).toBe('slot_unavailable') // ends after 18:00
    expect(await errorCode(book(gel, '2026-11-16', h(12)))).toBe('slot_unavailable') // Monday: closed
    const soon = new Date(ubToUtc(THU, h(15)).getTime() - 60 * 60_000) // one hour before
    expect(await errorCode(book(gel, THU, h(15), { now: soon }))).toBe('slot_unavailable')
  })

  it('suggests alternatives when the slot is gone', async () => {
    try {
      await book(gel, THU, h(10))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError)
      const alternatives = (err as ServiceError).details as { alternatives: unknown[] }
      expect(alternatives.alternatives.length).toBeGreaterThan(0)
    }
  })

  it('lets exactly one of two simultaneous requests for the same slot through', async () => {
    const attempts = await Promise.allSettled([book(gel, FRI, h(14)), book(gel, FRI, h(14)), book(gel, FRI, h(14))])
    const won = attempts.filter((a) => a.status === 'fulfilled')
    const lost = attempts.filter((a) => a.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(2)
    for (const l of lost) expect(((l as PromiseRejectedResult).reason as ServiceError).code).toBe('slot_unavailable')

    const [{ n }] = await env.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.appointments)
      .where(and(eq(t.appointments.staffId, solongo), eq(t.appointments.startsAt, ubToUtc(FRI, h(14)))))
    expect(n).toBe(1)
  })

  it('has a database constraint as the last line of defence', async () => {
    const [a] = await env.db
      .select()
      .from(t.appointments)
      .where(and(eq(t.appointments.staffId, solongo), eq(t.appointments.startsAt, ubToUtc(THU, h(13, 30)))))
    // Move the second booking onto the first one directly, bypassing the service.
    const clash = env.db.execute(
      sql`update salon.appointments set starts_at = ${ubToUtc(THU, h(10, 30))}, ends_at = ${ubToUtc(THU, h(12))},
          occupied_until = ${ubToUtc(THU, h(12, 10))} where id = ${a.id}`,
    )
    expect(await errorCode(clash)).toBe('23P01') // exclusion_violation
  })
})

describe('deposit holds', () => {
  it('holds the slot while the deposit is pending and frees it after expiry', async () => {
    const held = await book(extensions, '2026-11-17', h(10))
    expect(held.status).toBe('awaiting_deposit')
    expect(held.depositAmount).toBe(20_000)
    expect(new Date(held.holdExpiresAt!).getTime() - NOW.getTime()).toBe(20 * 60_000)

    // While held, the slot is not available.
    expect(await errorCode(book(gel, '2026-11-17', h(10)))).toBe('slot_unavailable')

    // 21 minutes later the hold has lapsed.
    const later = new Date(NOW.getTime() + 21 * 60_000)
    expect(await expireStaleHolds(env.db, env.salonId, later)).toBe(1)
    const [appt] = await env.db.select().from(t.appointments).where(eq(t.appointments.id, held.appointmentId))
    expect(appt.status).toBe('expired')

    const rebooked = await book(gel, '2026-11-17', h(10), { now: later })
    expect(rebooked.status).toBe('pending')
  })
})

describe('changing a booking', () => {
  it('confirms, reschedules with the original price and keeps the history', async () => {
    const original = await book(gel, '2026-11-18', h(15))
    await transitionAppointment(ctx(), original.appointmentId, 'confirmed', { actor: 'staff' })

    // The salon raises the price afterwards; the booking keeps what the customer agreed to.
    await env.db.update(t.services).set({ price: 70_000 }).where(eq(t.services.id, gel))
    const moved = await rescheduleAppointment(
      ctx(),
      original.appointmentId,
      { date: '2026-11-19', start: h(11), staffId: null },
      { actor: 'customer', publicRules: true },
    )
    await env.db.update(t.services).set({ price: 65_000 }).where(eq(t.services.id, gel))

    expect(moved.reference).not.toBe(original.reference)
    const [oldRow] = await env.db.select().from(t.appointments).where(eq(t.appointments.id, original.appointmentId))
    const [newRow] = await env.db.select().from(t.appointments).where(eq(t.appointments.id, moved.appointmentId))
    expect(oldRow.status).toBe('rescheduled')
    expect(newRow.rescheduledFromId).toBe(original.appointmentId)
    expect(newRow.totalPrice).toBe(65_000)
    expect(newRow.manageTokenHash).toBe(oldRow.manageTokenHash) // the customer's link keeps working

    // The old time is free again.
    const reuse = await book(gel, '2026-11-18', h(15))
    expect(reuse.status).toBe('pending')
  })

  it('records cancellations and releases the slot', async () => {
    const b = await book(gel, '2026-11-20', h(10))
    await transitionAppointment(ctx(), b.appointmentId, 'cancelled', { actor: 'customer', reason: 'customer_request' })
    const [record] = await env.db
      .select()
      .from(t.cancellationRecords)
      .where(eq(t.cancellationRecords.appointmentId, b.appointmentId))
    expect(record).toMatchObject({ cancelledBy: 'customer', withinPolicy: true })
    expect((await book(gel, '2026-11-20', h(10))).status).toBe('pending')
  })

  it('rejects transitions the status machine does not allow', async () => {
    const b = await book(gel, '2026-11-21', h(10))
    expect(await errorCode(transitionAppointment(ctx(), b.appointmentId, 'confirmed', { actor: 'customer' }))).toBe(
      'invalid_transition',
    )
    await transitionAppointment(ctx(), b.appointmentId, 'confirmed', { actor: 'staff' })
    // Attendance can only be recorded once the appointment has started.
    expect(await errorCode(transitionAppointment(ctx(), b.appointmentId, 'completed', { actor: 'staff' }))).toBe(
      'too_early',
    )
    const afterStart = ubToUtc('2026-11-21', h(12))
    await transitionAppointment(ctx(afterStart), b.appointmentId, 'completed', { actor: 'staff' })
    expect(
      await errorCode(transitionAppointment(ctx(afterStart), b.appointmentId, 'cancelled', { actor: 'staff' })),
    ).toBe('invalid_transition')
  })
})
