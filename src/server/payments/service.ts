// Payment workflows: deposit invoices, provider verification, staff-recorded
// payments and refunds. A payment becomes "paid" only through
// verifyPayment() (provider check) or recordManualPayment() (staff record of
// cash/card received) — never from a browser success message.
import { and, eq, sql } from 'drizzle-orm'
import { STATUS_LABELS } from '@/lib/booking/status'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { appUrl } from '@/server/app-url'
import { ERR, ServiceError, type ServiceContext } from '@/server/context'
import { deliverNotification, queueNotification } from '@/server/notifications'
import { hmac } from '@/server/security/crypto'
import { getPaymentProvider, paymentMode } from './index'
import { SIMULATED_BANK_EVENT } from './simulated'

type PaymentRow = typeof t.payments.$inferSelect

export interface PaymentView {
  id: string
  amount: number
  status: PaymentRow['status']
  provider: string
  mode: 'mock' | 'sandbox' | 'production'
  qrText: string | null
  shortUrl: string | null
  expiresAt: string | null
  paidAt: string | null
  appointmentStatus: (typeof t.appointmentStatus.enumValues)[number]
}

export function callbackSignature(paymentId: string) {
  return hmac(`qpay-callback:${paymentId}`, 'QPAY_CALLBACK_SECRET')
}

async function loadPayment(db: Database, salonId: string, paymentId: string) {
  const [row] = await db
    .select({ payment: t.payments, appointment: t.appointments })
    .from(t.payments)
    .innerJoin(t.appointments, eq(t.appointments.id, t.payments.appointmentId))
    .where(and(eq(t.payments.id, paymentId), eq(t.payments.salonId, salonId)))
  if (!row) throw ERR.notFound('Төлбөр')
  return row
}

function view(payment: PaymentRow, appointmentStatus: PaymentView['appointmentStatus']): PaymentView {
  return {
    id: payment.id,
    amount: payment.amount,
    status: payment.status,
    provider: payment.provider,
    mode: payment.provider === 'qpay' ? paymentMode() : 'mock',
    qrText: payment.qrText,
    shortUrl: payment.shortUrl,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
    paidAt: payment.paidAt?.toISOString() ?? null,
    appointmentStatus,
  }
}

/** Creates the provider invoice for a pending deposit (once) and returns what the payment page needs. */
export async function ensureDepositInvoice(ctx: ServiceContext, paymentId: string): Promise<PaymentView> {
  const { payment, appointment } = await loadPayment(ctx.db, ctx.salonId, paymentId)
  if (payment.status !== 'pending' || appointment.status !== 'awaiting_deposit' || payment.providerInvoiceId) {
    return view(payment, appointment.status)
  }
  const provider = getPaymentProvider(ctx.db)
  const invoice = await provider.createInvoice({
    reference: `${appointment.reference}-D${payment.id.slice(0, 4)}`,
    amount: payment.amount,
    description: `Сувд урьдчилгаа ${appointment.reference}`,
    receiverCode: 'terminal',
    callbackUrl: appUrl(`/api/payments/qpay/callback?payment=${payment.id}&sig=${callbackSignature(payment.id)}`),
  })
  const [updated] = await ctx.db
    .update(t.payments)
    .set({
      providerInvoiceId: invoice.providerInvoiceId,
      qrText: invoice.qrText,
      shortUrl: invoice.shortUrl,
      updatedAt: ctx.now,
    })
    .where(and(eq(t.payments.id, payment.id), sql`${t.payments.providerInvoiceId} is null`))
    .returning()
  await ctx.db.insert(t.paymentRecords).values({
    paymentId: payment.id,
    event: 'invoice_created',
    detail: { mode: provider.mode, invoiceId: invoice.providerInvoiceId },
    createdAt: ctx.now,
  })
  return view(updated ?? payment, appointment.status)
}

/**
 * Asks the provider whether the invoice is paid. Only a positive provider
 * answer marks the payment paid and confirms the held appointment.
 */
export async function verifyPayment(
  ctx: ServiceContext,
  paymentId: string,
  source: 'callback' | 'customer' | 'staff' | 'cron',
): Promise<PaymentView> {
  const { payment, appointment } = await loadPayment(ctx.db, ctx.salonId, paymentId)
  if (payment.status === 'paid' || !payment.providerInvoiceId) return view(payment, appointment.status)
  const provider = getPaymentProvider(ctx.db)
  const check = await provider.checkInvoice(payment.providerInvoiceId)
  await ctx.db.insert(t.paymentRecords).values({
    paymentId: payment.id,
    event: check.paid ? 'check_paid' : 'check_unpaid',
    detail: { source, paidAmount: check.paidAmount, mode: provider.mode },
    createdAt: ctx.now,
  })
  if (!check.paid || check.paidAmount < payment.amount) return view(payment, appointment.status)

  let notificationId: string | null = null
  const result = await ctx.db.transaction(async (tx) => {
    const [paid] = await tx
      .update(t.payments)
      .set({
        status: 'paid',
        paidAt: ctx.now,
        verifiedBy: 'provider_check',
        providerPaymentId: check.payments[0]?.providerPaymentId ?? null,
        updatedAt: ctx.now,
      })
      .where(and(eq(t.payments.id, payment.id), sql`${t.payments.status} in ('pending', 'expired')`))
      .returning()
    if (!paid) return null
    const [appt] = await tx.select().from(t.appointments).where(eq(t.appointments.id, appointment.id)).for('update')
    if (appt.status === 'awaiting_deposit') {
      await tx
        .update(t.appointments)
        .set({ status: 'confirmed', confirmedAt: ctx.now, holdExpiresAt: null, updatedAt: ctx.now })
        .where(eq(t.appointments.id, appt.id))
      await tx.insert(t.appointmentEvents).values({
        appointmentId: appt.id,
        kind: 'deposit_paid',
        fromStatus: 'awaiting_deposit',
        toStatus: 'confirmed',
        actorType: 'system',
        note: `Урьдчилгаа ${payment.amount}₮ төлбөрийн системээр баталгаажсан.`,
        createdAt: ctx.now,
      })
      const [info] = await tx
        .select({
          salonName: t.salons.name,
          customerName: t.customers.name,
          customerPhone: t.customers.phone,
          staffName: t.staff.displayName,
        })
        .from(t.appointments)
        .innerJoin(t.salons, eq(t.salons.id, t.appointments.salonId))
        .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
        .innerJoin(t.staff, eq(t.staff.id, t.appointments.staffId))
        .where(eq(t.appointments.id, appt.id))
      notificationId = await queueNotification(tx, {
        salonId: ctx.salonId,
        appointmentId: appt.id,
        kind: 'deposit_paid',
        isDemo: appt.isDemo,
        vars: {
          ...info,
          reference: appt.reference,
          startsAt: appt.startsAt,
          services: '',
          statusLabel: STATUS_LABELS.confirmed,
          amount: payment.amount,
        },
      })
      return { ...paid, appointmentStatus: 'confirmed' as const }
    }
    // Paid after the hold expired or the booking was cancelled: keep the money
    // on record and leave a clear note for staff to refund or rebook.
    await tx
      .update(t.payments)
      .set({ note: 'Цаг чөлөөлөгдсөний дараа төлөгдсөн — ажилтан холбогдож буцаан олгох эсвэл шинэ цаг тохирно.' })
      .where(eq(t.payments.id, payment.id))
    await tx.insert(t.appointmentEvents).values({
      appointmentId: appt.id,
      kind: 'late_payment',
      actorType: 'system',
      note: 'Урьдчилгаа цаг чөлөөлөгдсөний дараа төлөгдсөн. Ажилтан шийдвэрлэнэ.',
      createdAt: ctx.now,
    })
    return { ...paid, appointmentStatus: appt.status }
  })
  await deliverNotification(ctx.db, notificationId)
  if (!result) {
    const fresh = await loadPayment(ctx.db, ctx.salonId, paymentId)
    return view(fresh.payment, fresh.appointment.status)
  }
  return view(result, result.appointmentStatus)
}

/**
 * Demo only: stands in for the customer paying in their bank app. Writes the
 * provider-side record, then verifies through the provider like a callback.
 */
export async function simulateBankPayment(ctx: ServiceContext, paymentId: string): Promise<PaymentView> {
  const { payment } = await loadPayment(ctx.db, ctx.salonId, paymentId)
  if (payment.provider !== 'simulated' || paymentMode() !== 'mock') {
    throw new ServiceError('not_simulated', 'Энэ төлбөр бодит QPay-ээр хийгдэнэ — туршилтын төлбөр ашиглах боломжгүй.')
  }
  if (payment.status !== 'pending' || !payment.providerInvoiceId) {
    return verifyPayment(ctx, paymentId, 'customer')
  }
  await ctx.db.insert(t.paymentRecords).values({
    paymentId: payment.id,
    event: SIMULATED_BANK_EVENT,
    detail: { note: 'Туршилтын төлбөр — мөнгө шилжээгүй', amount: payment.amount },
    createdAt: ctx.now,
  })
  return verifyPayment(ctx, paymentId, 'callback')
}

/** Staff record of a payment received in the salon (cash, card, bank transfer). */
export async function recordManualPayment(
  ctx: ServiceContext,
  appointmentId: string,
  input: {
    amount: number
    method: 'cash' | 'card' | 'bank_transfer' | 'qpay'
    kind: 'balance' | 'full' | 'deposit'
    note: string | null
  },
) {
  const [appt] = await ctx.db
    .select()
    .from(t.appointments)
    .where(and(eq(t.appointments.id, appointmentId), eq(t.appointments.salonId, ctx.salonId)))
  if (!appt) throw ERR.notFound('Захиалга')
  if (input.amount <= 0) throw new ServiceError('invalid_amount', 'Төлбөрийн дүн 0-ээс их байна.')
  const [row] = await ctx.db
    .insert(t.payments)
    .values({
      salonId: ctx.salonId,
      appointmentId,
      kind: input.kind,
      method: input.method,
      status: 'paid',
      amount: input.amount,
      provider: 'manual',
      paidAt: ctx.now,
      verifiedBy: 'staff_record',
      recordedByAdminId: ctx.actor?.adminUserId ?? null,
      note: input.note,
      isDemo: appt.isDemo,
      createdAt: ctx.now,
    })
    .returning()
  await ctx.db.insert(t.paymentRecords).values({
    paymentId: row.id,
    event: 'staff_recorded',
    detail: { method: input.method, amount: input.amount },
    createdAt: ctx.now,
  })
  await ctx.db.insert(t.appointmentEvents).values({
    appointmentId,
    kind: 'payment_recorded',
    actorType: 'staff',
    actorAdminId: ctx.actor?.adminUserId ?? null,
    note: `${input.amount}₮ төлбөр бүртгэв`,
    meta: { method: input.method, kind: input.kind },
    createdAt: ctx.now,
  })
  return row
}

/** Refund a paid payment. Real QPay refunds go through the provider first. */
export async function refundPayment(ctx: ServiceContext, paymentId: string, note: string | null) {
  const { payment } = await loadPayment(ctx.db, ctx.salonId, paymentId)
  if (payment.status !== 'paid') throw new ServiceError('not_paid', 'Зөвхөн төлөгдсөн төлбөрийг буцаана.')
  if (payment.provider === 'qpay') {
    if (!payment.providerPaymentId) throw new ServiceError('missing_provider_id', 'QPay гүйлгээний дугаар алга.')
    await getPaymentProvider(ctx.db).refundPayment(
      payment.providerPaymentId,
      note ?? 'Буцаан олголт',
      appUrl('/api/payments/qpay/callback'),
    )
  }
  await ctx.db
    .update(t.payments)
    .set({ status: 'refunded', note, updatedAt: ctx.now })
    .where(eq(t.payments.id, payment.id))
  await ctx.db.insert(t.paymentRecords).values({
    paymentId: payment.id,
    event: 'refunded',
    detail: { amount: payment.amount, note, by: ctx.actor?.adminUserId ?? null },
    createdAt: ctx.now,
  })
}
