import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ubToUtc } from '@/lib/datetime'
import { ServiceError } from '@/server/context'
import * as t from '@/server/db/schema'
import {
  ensureDepositInvoice,
  recordManualPayment,
  simulateBankPayment,
  verifyPayment,
} from '@/server/payments/service'
import { createBooking, transitionAppointment } from '@/server/services/booking'
import { context, customer, freshDatabase, h, serviceId, staffId, type TestDb } from './db'

const NOW = new Date('2026-11-03T00:00:00Z')

let env: TestDb
let extensions: string
let solongo: string

beforeAll(async () => {
  env = await freshDatabase()
  extensions = await serviceId(env.db, env.salonId, 'nail-extensions')
  solongo = await staffId(env.db, env.salonId, 'solongo')
})
afterAll(() => env.close())
afterEach(() => {
  process.env.QPAY_MODE = 'mock'
})

const ctx = (now = NOW) => context(env.db, env.salonId, now)

/** A 120,000₮ booking that requires a 20,000₮ deposit. */
async function heldBooking(date: string, start = h(10)) {
  const booking = await createBooking(
    ctx(),
    { items: [{ serviceId: extensions, addonIds: [] }], staffId: solongo, date, start, customer: customer() },
    { source: 'website', actor: 'customer', publicRules: true, isDemo: true },
  )
  expect(booking.status).toBe('awaiting_deposit')
  return booking
}

const paymentRow = async (id: string) => (await env.db.select().from(t.payments).where(eq(t.payments.id, id)))[0]
const appointmentStatus = async (id: string) =>
  (await env.db.select().from(t.appointments).where(eq(t.appointments.id, id)))[0].status

describe('deposits', () => {
  it('stays unpaid until the payment provider reports the payment', async () => {
    const b = await heldBooking('2026-11-12')
    const invoice = await ensureDepositInvoice(ctx(), b.depositPaymentId!)
    expect(invoice.mode).toBe('mock')
    expect(invoice.qrText).toContain('NOT-A-PAYMENT')

    // A customer pressing "I paid" only triggers a provider check.
    const checked = await verifyPayment(ctx(), b.depositPaymentId!, 'customer')
    expect(checked.status).toBe('pending')
    expect(await appointmentStatus(b.appointmentId)).toBe('awaiting_deposit')
  })

  it('marks the deposit paid and confirms the booking after the provider confirms', async () => {
    const b = await heldBooking('2026-11-13')
    await ensureDepositInvoice(ctx(), b.depositPaymentId!)
    const paid = await simulateBankPayment(ctx(), b.depositPaymentId!)
    expect(paid.status).toBe('paid')
    expect(paid.appointmentStatus).toBe('confirmed')

    const row = await paymentRow(b.depositPaymentId!)
    expect(row).toMatchObject({ status: 'paid', verifiedBy: 'provider_check', amount: 20_000 })
    expect(row.paidAt).not.toBeNull()

    // Verifying again is harmless.
    expect((await verifyPayment(ctx(), b.depositPaymentId!, 'cron')).status).toBe('paid')
  })

  it('refuses the test payment when real QPay is configured', async () => {
    const b = await heldBooking('2026-11-14')
    await ensureDepositInvoice(ctx(), b.depositPaymentId!)
    process.env.QPAY_MODE = 'sandbox'
    try {
      await simulateBankPayment(ctx(), b.depositPaymentId!)
      expect.unreachable()
    } catch (err) {
      expect((err as ServiceError).code).toBe('not_simulated')
    }
    expect((await paymentRow(b.depositPaymentId!)).status).toBe('pending')
  })

  it('refunds a paid deposit when the customer cancels in time and keeps it when late', async () => {
    const early = await heldBooking('2026-11-17')
    await ensureDepositInvoice(ctx(), early.depositPaymentId!)
    await simulateBankPayment(ctx(), early.depositPaymentId!)
    const out = await transitionAppointment(ctx(), early.appointmentId, 'cancelled', {
      actor: 'customer',
      reason: 'customer_request',
    })
    expect(out.depositOutcome).toBe('refund')
    expect((await paymentRow(early.depositPaymentId!)).status).toBe('refunded')

    const late = await heldBooking('2026-11-18')
    await ensureDepositInvoice(ctx(), late.depositPaymentId!)
    await simulateBankPayment(ctx(), late.depositPaymentId!)
    const twoHoursBefore = new Date(ubToUtc('2026-11-18', h(10)).getTime() - 2 * 3_600_000)
    const lateOut = await transitionAppointment(ctx(twoHoursBefore), late.appointmentId, 'cancelled', {
      actor: 'customer',
      reason: 'customer_request',
    })
    expect(lateOut.depositOutcome).toBe('forfeit')
    expect((await paymentRow(late.depositPaymentId!)).status).toBe('paid')
  })

  it('records money taken in the salon as a staff record', async () => {
    const b = await heldBooking('2026-11-19')
    const payment = await recordManualPayment(ctx(), b.appointmentId, {
      amount: 100_000,
      method: 'cash',
      kind: 'balance',
      note: null,
    })
    expect(payment).toMatchObject({ status: 'paid', verifiedBy: 'staff_record', method: 'cash' })
  })
})
